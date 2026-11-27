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
