/** v7.3.0 – fizetési emlékeztető (ál-levéltovábbítóval) és banki szabály a kivonat-feldolgozásban. */
import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("emlékeztető és banki szabály", () => {
  it("emlékeztető: csak lejárt, e-mail kell, 3 napos védelem; szabály → könyvelés + számláló", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { sent.push(JSON.parse(b)); res.end(JSON.stringify({ ok: true })); }); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    Object.assign(process.env, { DATABASE_URL: url, MAIL_RELAY_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`, MAIL_RELAY_SECRET: "x" });
    delete process.env.MAIL_PROVIDER;
    try {
      const { db, schema } = await import("@/db");
      const { eq, and } = await import("drizzle-orm");
      const D = await import("@/lib/demo");
      const R = await import("@/lib/payment-reminder");
      const S = await import("@/lib/inbox/service");
      const [u] = await db.insert(schema.users).values({ email: `rr${Date.now()}@t.local`, name: "Könyvelő Kata", passwordHash: "x" }).returning();
      const { id: cid } = await D.createDemoCompany(u.id);
      // a demóban a 2-es indexű partner (Dráva Futár) számlája lejárt és nyitott
      const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.companyId, cid), eq(schema.partners.name, "Dráva Futár Kft.")));
      await expect(R.sendPaymentReminder(cid, p.id, u)).rejects.toThrow(/nincs \(érvényes\) e-mail/);
      await db.update(schema.partners).set({ email: "penzugy@dravafutar.hu" }).where(eq(schema.partners.id, p.id));
      const r = await R.sendPaymentReminder(cid, p.id, u, { bankAccount: "11773016-12345678" });
      expect(r).toMatchObject({ to: "penzugy@dravafutar.hu", count: 1 });
      expect(sent[0].to).toBe("penzugy@dravafutar.hu");
      expect(sent[0].text).toContain("11773016-12345678");
      expect(sent[0].text).toContain("Könyvelő Kata");
      await expect(R.sendPaymentReminder(cid, p.id, u)).rejects.toThrow(/3 napon belül/);
      await R.sendPaymentReminder(cid, p.id, u, { force: true });
      expect(sent).toHaveLength(2);
      const [nem] = await db.select().from(schema.partners).where(and(eq(schema.partners.companyId, cid), eq(schema.partners.name, "Nagy Péter")));
      await db.update(schema.partners).set({ email: "np@x.hu" }).where(eq(schema.partners.id, nem.id));
      await expect(R.sendPaymentReminder(cid, nem.id, u)).rejects.toThrow(/nincs lejárt/);

      // banki szabály
      await db.insert(schema.bankRules).values({ companyId: cid, pattern: "NAV", direction: "in", accountCode: "463" });
      const x = { docType: "bank_statement", direction: "in", statement: { currency: "HUF", transactions: [
        { date: "2026-11-20", amount: -81234, counterparty: "NAV", description: "ÁFA befizetés", reference: null },
        { date: "2026-11-21", amount: -5555, counterparty: "Ismeretlen", description: "valami", reference: null },
      ] } };
      const id = await S.addDocument(cid, { source: "upload", sourceRef: `t:${Date.now()}`, kind: "statement", filename: "k.json", mime: "application/json", data: "e30=", extracted: x as never });
      await S.processDocument(cid, id!, u.id, { autoPost: true });
      const [d] = await db.select().from(schema.inboxDocuments).where(eq(schema.inboxDocuments.id, id!));
      const rows = d.proposal!.statement!.rows;
      expect(rows[0]).toMatchObject({ action: "entry", accountCode: "463", done: true });
      expect(rows[1].action).toBe("review");
      const [rule] = await db.select().from(schema.bankRules).where(eq(schema.bankRules.companyId, cid));
      expect(rule.hits).toBe(1);
    } finally { srv.close(); }
  });
});
