/** v6.10.0 – számlázz.hu / Billingo behúzás egy helyi ál-szerverrel: sorszám-léptetés, évváltás, lapozás, duplikáció, feldolgozás. */
import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const year = new Date().getFullYear();
const szamla = (n: string, vevo: string) => `<?xml version="1.0"?><szamla xmlns="http://www.szamlazz.hu/szamla">
  <alap><szamlaszam>${n}</szamlaszam><tipus>SZ</tipus><kelt>${year}-01-05</kelt><telj>${year}-01-05</telj><fizh>${year}-01-13</fizh><fizmod>Átutalás</fizmod><devizanem>HUF</devizanem></alap>
  <vevo><nev>${vevo}</nev><adoszam>12345676-2-02</adoszam></vevo>
  <tetelek><tetel><nev>Szerviz</nev><mennyiseg>1</mennyiseg><nettoegysegar>10000</nettoegysegar><afakulcs>27</afakulcs><netto>10000</netto><afa>2700</afa><brutto>12700</brutto></tetel></tetelek>
  <osszegek><totalossz><netto>10000</netto><afa>2700</afa><brutto>12700</brutto></totalossz></osszegek>
  <pdf>${Buffer.from(`%PDF-1.4 ${n}`).toString("base64")}</pdf></szamla>`;

describe.skipIf(!url)("számlázóprogram-integráció", () => {
  it("számlázz.hu: sorszámonként, évváltással; Billingo: lapozva, díjbekérő nélkül; másodszor nem hoz újra", async () => {
    // ál-számlázz.hu: (előző év)-41..42 és (idei év)-1 létezik; ál-Billingo: 2 oldal
    const have = new Map([[`E-T-${year - 1}-41`, "Régi Kft."], [`E-T-${year - 1}-42`, "Régi Kft."], [`E-T-${year}-1`, "Új Kft."]]);
    const calls: string[] = [];
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        if (req.url?.startsWith("/szamla")) {
          const n = /<szamlaszam>(.*?)<\/szamlaszam>/.exec(body)?.[1] ?? "";
          calls.push(n);
          if (!body.includes("<szamlaagentkulcs>AGENT</szamlaagentkulcs>")) { res.writeHead(200, { szlahu_error_code: "3", szlahu_error: "Rossz kulcs" }); return res.end("x"); }
          if (!have.has(n)) { res.writeHead(200, { szlahu_error_code: "7", szlahu_error: "A számla nem található" }); return res.end("x"); }
          res.writeHead(200, { "content-type": "text/xml" }); return res.end(szamla(n, have.get(n)!));
        }
        if (req.headers["x-api-key"] !== "BKEY") { res.writeHead(401); return res.end("{}"); }
        const u = new URL(req.url!, "http://x");
        if (/\/documents\/\d+\/download/.test(u.pathname)) { res.writeHead(200, { "content-type": "application/pdf" }); return res.end(`%PDF-1.4 billingo ${u.pathname}`); }
        const page = Number(u.searchParams.get("page"));
        const mk = (id: number, type = "invoice") => ({ id, invoice_number: `B-${id}`, type, payment_method: "cash", currency: "HUF", invoice_date: `${year}-02-01`, fulfillment_date: `${year}-02-01`, partner: { name: "Magán Ügyfél" }, items: [{ name: "Alkatrész", quantity: 1, net_unit_amount: 1000, net_amount: 1000, gross_amount: 1270, vat: "27%", vat_amount: 270 }], summary: { net_amount: 1000, vat_amount: 270, gross_amount: 1270 } });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(page === 1 ? { data: [mk(1), mk(2, "proforma")], last_page: 2, total: 3 } : { data: [mk(3)], last_page: 2, total: 3 }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    Object.assign(process.env, { DATABASE_URL: url, SZAMLAZZ_URL: `http://127.0.0.1:${port}/szamla/`, BILLINGO_URL: `http://127.0.0.1:${port}/v3` });
    try {
      const { db, schema } = await import("@/db");
      const { eq, and } = await import("drizzle-orm");
      const L = await import("@/lib/ledger");
      const S = await import("@/lib/inbox/service");
      const I = await import("@/lib/invoicing-sync");
      const { encryptSecret } = await import("@/lib/inbox/secret");
      const [u] = await db.insert(schema.users).values({ email: `inv${Date.now()}@t.local`, name: "I", passwordHash: "x" }).returning();
      const co = await L.createCompany(u.id, { name: `Számlázó Kft ${Date.now()}` } as never);
      const cid = (co as { id: number }).id;

      // rossz kulcs → érthető hiba
      await expect(I.testInvoicingKey("szamlazz", "ROSSZ", `E-T-${year - 1}-41`)).rejects.toThrow(/Rossz kulcs/);
      await expect(I.testInvoicingKey("billingo", "ROSSZ")).rejects.toThrow(/érvénytelen API-kulcs/);
      expect(await I.testInvoicingKey("billingo", "BKEY")).toContain("3 bizonylat");

      await S.saveInboxSettings(cid, { autoPost: false, invoicing: [
        { provider: "szamlazz", keyEnc: encryptSecret("AGENT"), prefix: `E-T-${year - 1}-`, nextSeq: 41 },
        { provider: "billingo", keyEnc: encryptSecret("BKEY"), since: `${year}-01-01` },
      ] });
      const r = await I.syncInvoicing(cid);
      expect(r.errors).toEqual([]);
      expect(r.fetched).toBe(5); // 41, 42, új év 1 + Billingo 1, 3
      const docs = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.companyId, cid));
      expect(docs.map((d) => d.sourceRef).sort()).toEqual(["billingo:1", "billingo:3", `szamlazz:E-T-${year - 1}-41`, `szamlazz:E-T-${year - 1}-42`, `szamlazz:E-T-${year}-1`].sort());
      expect(docs.every((d) => d.status === "extracted" && d.extracted?.direction === "out" && d.mime === "application/pdf")).toBe(true);

      const { settings } = await S.getInboxSettings(cid);
      const sz = settings.invoicing!.find((l) => l.provider === "szamlazz")!;
      expect(sz).toMatchObject({ prefix: `E-T-${year}-`, nextSeq: 2, lastResult: "3 új számla", lastError: null });

      // második futás: semmi új, a sorszám nem szalad el
      calls.length = 0;
      const r2 = await I.syncInvoicing(cid);
      expect(r2.fetched).toBe(0);
      expect(calls).toEqual([`E-T-${year}-2`, `E-T-${year}-3`, `E-T-${year}-4`]);
      expect((await S.getInboxSettings(cid)).settings.invoicing!.find((l) => l.provider === "szamlazz")!.nextSeq).toBe(2);

      // a feldolgozás javaslatot ad: kimenő számla, 27%-os ÁFA, a vevő adataival
      const one = docs.find((d) => d.sourceRef === `szamlazz:E-T-${year}-1`)!;
      expect(await S.processDocument(cid, one.id, u.id, { autoPost: false })).toBe("review");
      const [p] = await db.select().from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.id, one.id)));
      expect(p.proposal?.invoice).toMatchObject({ direction: "out", invoiceNumber: `E-T-${year}-1`, partner: { name: "Új Kft." } });
      expect(p.proposal?.invoice?.lines[0]).toMatchObject({ vatCode: "27", unitPrice: 10000 });
    } finally {
      srv.close();
    }
  });
});
