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
