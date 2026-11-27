import { describe, it, expect } from "vitest";
import { demoTaxNumber, demoPlan } from "@/lib/demo-calc";
import { helpFor, HELP } from "@/lib/help";
import { CHANGELOG, LATEST } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

describe("v6.12.0 – bemutató cég", () => {
  it("érvényes ellenőrző számjegyű adószám", () => {
    const t = demoTaxNumber("1234567");
    expect(t).toMatch(/^\d{8}-2-02$/);
    const d = t.slice(0, 8).split("").map(Number);
    const s = [9, 7, 3, 1, 9, 7, 3].reduce((a, w, i) => a + w * d[i], 0);
    expect((10 - (s % 10)) % 10).toBe(d[7]);
  });
  it("a terv a mai naphoz igazodik, minden dátum a múltban, van nyitott és lejárt vevőszámla", () => {
    const p = demoPlan("2026-11-27");
    expect(p.capitalDate < p.out[0].date).toBe(true);
    expect([...p.out, ...p.inn].every((x) => x.date <= "2026-11-27")).toBe(true);
    const open = p.out.filter((o) => !o.paid);
    expect(open.length).toBeGreaterThan(0);
    expect(open.some((o) => o.due < "2026-11-27")).toBe(true);
    expect(new Set(p.out.map((o) => o.n)).size).toBe(p.out.length);
  });
});

describe("v6.12.0 – súgó és újdonságok", () => {
  it("az oldalhoz tartozó súgórész", () => {
    expect(helpFor("/c/12/invoices/new")).toBe("szamlak");
    expect(helpFor("/c/12/inbox/settings")).toBe("bizonylatok");
    expect(helpFor("/c/12")).toBe("kezdes");
    expect(helpFor("/c/12/ismeretlen")).toBe("kezdes");
    expect(new Set(HELP.map((h) => h.id)).size).toBe(HELP.length);
  });
  it("a legfrissebb újdonság az aktuális verzió", () => {
    expect(LATEST).toBe(APP_VERSION);
    expect(CHANGELOG.every((r) => r.items.length > 0)).toBe(true);
  });
});

describe("v7.0.0 – adatbázis-védelmi üzenetek", () => {
  it("a trigger (check_violation) üzenete jelenik meg a nyers lekérdezés helyett", async () => {
    const { errMsg } = await import("@/lib/action-utils");
    const e = Object.assign(new Error("Failed query: insert into journal_lines …"), { cause: { code: "23514", message: "Cégek közötti hivatkozás nem megengedett (accounts, #5)." } });
    expect(errMsg(e)).toBe("Cégek közötti hivatkozás nem megengedett (accounts, #5).");
    expect(errMsg(new Error("sima hiba"))).toBe("sima hiba");
  });
});

describe("v7.1.0 – feltöltött fájlok kiszolgálása", () => {
  it("csak a biztonságos típusok nyílnak meg, a többi letöltés", async () => {
    const { servedAs } = await import("@/lib/file-serve");
    expect(servedAs("application/pdf")).toEqual({ type: "application/pdf", inline: true });
    expect(servedAs("IMAGE/JPEG")).toEqual({ type: "image/jpeg", inline: true });
    expect(servedAs("text/csv")).toEqual({ type: "text/csv; charset=utf-8", inline: true });
    expect(servedAs("text/html")).toEqual({ type: "application/octet-stream", inline: false });
    expect(servedAs("image/svg+xml").inline).toBe(false);
    expect(servedAs("application/xml").inline).toBe(false);
    expect(servedAs("").inline).toBe(false);
  });
});

describe("v7.2.0 – tárolóbeli mentések kulcsai", () => {
  it("kulcs, visszafejtés, régiek törlése", async () => {
    const C = await import("@/lib/cloud-backup-calc");
    const k = C.backupKey(3, 17, new Date("2026-11-27T14:05:09Z"));
    expect(k).toBe("backups/o3/c17/2026-11-27_140509.json.gz");
    expect(C.parseBackupKey(k)).toEqual({ companyId: 17, at: "2026-11-27T14:05:09Z" });
    expect(C.parseBackupKey("backups/o3/valami")).toEqual({ companyId: null, at: null });
    const keys = ["a/2026-01-01_000000", "a/2026-03-01_000000", "a/2026-02-01_000000"];
    expect(C.pruneList(keys, 2)).toEqual(["a/2026-01-01_000000"]);
    expect(C.pruneList(keys, 5)).toEqual([]);
  });
});

describe("v7.3.0 – fizetési emlékeztető és banki szabályok", () => {
  it("emlékeztető levél: tételek, összesítés devizánként, védjegy, HTML-escape", async () => {
    const { renderReminder } = await import("@/lib/payment-reminder-calc");
    const m = renderReminder({ companyName: "Teszt Kft", partnerName: "Vevő <Bt>", today: "2026-11-27", bankAccount: "11111111-22222222", contactName: "Marci", contactEmail: "m@x.hu",
      items: [{ invoiceNumber: "A-1", issueDate: "2026-10-01", dueDate: "2026-10-09", openFx: 127000, currency: "HUF" }, { invoiceNumber: "A-2", issueDate: "2026-11-01", dueDate: "2026-11-09", openFx: 100.5, currency: "EUR" }] });
    expect(m.subject).toBe("Fizetési emlékeztető – 2 számla (Teszt Kft)");
    m.text = m.text.replace(/[\u00a0\u202f]/g, " ");
    expect(m.text).toContain("A-1: kelte 2026.10.01., esedékes 2026.10.09., nyitott 127 000 Ft (49 napja lejárt)");
    expect(m.text).toContain("Összesen: 127 000 Ft + 100,50 EUR");
    expect(m.text).toContain("11111111-22222222");
    expect(m.text).toContain("Mogyorosi Holding™");
    expect(m.html).toContain("Vevő &lt;Bt&gt;");
    expect(() => renderReminder({ companyName: "x", partnerName: "y", today: "2026-01-01", items: [] })).toThrow();
  });
  it("banki szabály: ékezet/kisbetű független, irány, első találat", async () => {
    const { matchBankRule } = await import("@/lib/inbox/propose");
    const rules = [
      { id: 1, pattern: "NAV", direction: "in", accountCode: "463", label: null },
      { id: 2, pattern: "kamatjóváírás", direction: "out", accountCode: "972", label: null },
      { id: 3, pattern: "nav", direction: "any", accountCode: "469", label: null },
    ];
    expect(matchBankRule(rules, "Átutalás · NAV ÁFA 2026/10", -50000)?.id).toBe(1);
    expect(matchBankRule(rules, "NAV visszatérítés", 20000)?.id).toBe(3);
    expect(matchBankRule(rules, "KAMATJOVAIRAS november", 120)?.accountCode).toBe("972");
    expect(matchBankRule(rules, "Telekom", -1000)).toBeNull();
    expect(matchBankRule(undefined, "NAV", -1)).toBeNull();
  });
});

describe("v7.4.0 – kereső és PDF", () => {
  it("keresőkifejezés értelmezése", async () => {
    const { parseQuery } = await import("@/lib/search-calc");
    expect(parseQuery("  127 000 ")).toMatchObject({ s: "127 000", amount: 127000, digits: "127000" });
    expect(parseQuery("1.270,50").amount).toBe(1270.5);
    expect(parseQuery("50").amount).toBeNull();
    expect(parseQuery("Kovács 100%_").like).toBe("%Kovács 100\\%\\_%");
  });
  it("PDF: magyar ékezetek, több oldal, védjegy a láblécben", async () => {
    const { renderPdfReport } = await import("@/lib/pdf-report");
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await renderPdfReport({ title: "Főkönyvi kivonat", company: "Árvíztűrő Tükörfúrógép Kft.", columns: [{ label: "Számla", width: 80 }, { label: "Összeg", width: 100, align: "right" }],
      rows: Array.from({ length: 120 }, (_, i) => ({ cells: [`őű-${i}`, `${i * 1000}`] })) });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getCreator()).toContain("Mogyorosi Holding™");
  });
});

describe("v7.5.0 – jóváhagyás", () => {
  it("csak bekapcsolva, bejövő, könyvelt, jóvá nem hagyott, küszöb felett", async () => {
    const { needsApproval, canApprove } = await import("@/lib/approval-calc");
    const inv = { direction: "in", grossHuf: "150000", approvedAt: null, status: "posted" };
    expect(needsApproval({ on: true, threshold: 100000 }, inv)).toBe(true);
    expect(needsApproval({ on: true, threshold: 200000 }, inv)).toBe(false);
    expect(needsApproval({ on: false, threshold: 0 }, inv)).toBe(false);
    expect(needsApproval(null, inv)).toBe(false);
    expect(needsApproval({ on: true, threshold: 0 }, { ...inv, direction: "out" })).toBe(false);
    expect(needsApproval({ on: true, threshold: 0 }, { ...inv, approvedAt: new Date() })).toBe(false);
    expect(needsApproval({ on: true, threshold: 0 }, { ...inv, status: "draft" })).toBe(false);
    expect([canApprove("owner"), canApprove("viewer"), canApprove("accountant"), canApprove("uploader")]).toEqual([true, true, false, false]);
  });
});
