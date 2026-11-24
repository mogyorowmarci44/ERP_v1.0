import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { money, renderCompanyMail, renderHoldingMail } from "@/lib/daily-summary/render";
import { shouldRunNow, journalCsv } from "@/lib/daily-summary/send";
import { pezcar, holding } from "./fixtures/daily-summary";
import { ft0, mFt2 } from "@/lib/daily-summary/format";

vi.mock("@/db", () => ({ db: {}, schema: {} }));

describe("pénz formázás", () => {
  it("M / e / Ft", () => {
    expect(money(2_310_000)).toBe("2,31 m Ft");
    expect(money(612_400, true)).toBe("+612 e Ft");
    expect(money(-84_000, true)).toBe("−84 e Ft");
    expect(money(840)).toBe("840 Ft");
    expect(ft0(-0.3)).toBe("0 Ft"); // v3.9.9: nincs „-0 Ft”
    expect(mFt2(4_720_000)).toBe("4,72 m Ft");
  });
});

describe("változatok blokkjai", () => {
  it("ügyvezető: autókészlet igen, napló nem", () => {
    const m = renderCompanyMail(pezcar, "ceo");
    expect(m.html).toContain("KészletMérleg szerint");
    expect(m.html).not.toContain("Tegnapi egyéb történések");
    expect(m.html).toContain("PezCar Kft</td>");
    expect(m.subject).toBe("PezCar Kft – napi összefoglaló, nov. 24. · 2 teendő");
  });
  it("pénzügyes: napló igen, autókészlet nem", () => {
    const m = renderCompanyMail(pezcar, "cfo");
    expect(m.html).toContain("Tegnapi egyéb történések");
    expect(m.html).not.toContain("KészletMérleg szerint");
  });
  it("teljes: mind", () => {
    const m = renderCompanyMail(pezcar, "full");
    expect(m.html).toContain("Tegnapi egyéb történések");
    expect(m.html).toContain("KészletMérleg szerint");
    expect(m.html).toContain("Várható éves eredmény (2026)");
    expect(m.html).toContain("Járulékbevallás");
    expect(m.html).toContain("Mogyorosi Holding™");
  });
  it("escape-el", () => {
    const m = renderCompanyMail({ ...pezcar, name: "<b>X</b>" }, "ceo");
    expect(m.html).not.toContain("<b>X</b>");
  });
});

describe("holding", () => {
  it("cégek, teendők cégnévvel, vendégház", () => {
    const m = renderHoldingMail(holding);
    expect(m.html).toContain("MM Car Trade Kft");
    expect(m.html).toContain("<b>PezCar Kft</b> · ");
    expect(m.html).toContain("43%");
    expect(m.subject).toMatch(/^Mogyorosi Holding – napi összefoglaló, nov\. 24\./);
  });
});

describe("ütemezési ablak", () => {
  it("06:45 és 12:00 között, naponta egyszer", () => {
    expect(shouldRunNow("05:59", null, "2026-11-24").ok).toBe(false);
    expect(shouldRunNow("06:59", null, "2026-11-24").ok).toBe(true);
    expect(shouldRunNow("07:20", "2026-11-23", "2026-11-24").ok).toBe(true);
    expect(shouldRunNow("07:59", "2026-11-24", "2026-11-24").ok).toBe(false);
    expect(shouldRunNow("12:05", null, "2026-11-24").ok).toBe(false);
  });
});

describe("CSV melléklet", () => {
  it("BOM, pontosvessző, idézőjel", () => {
    const c = journalCsv(pezcar);
    expect(c.content.startsWith("﻿")).toBe(true);
    expect(c.content).toContain('"VE · Suzuki Vitara eladás"');
    expect(c.filename).toBe("naplo_PezCar_Kft_2026-11-23.csv");
  });
});

describe("v3.9.3 kapcsolók", () => {
  it("fő kapcsoló és cégkapcsoló", async () => {
    const { companyEnabled } = await import("@/lib/daily-summary/send");
    const base = { enabled: true, holdingEnabled: true, disabledCompanies: [2], holdingEmails: [], lastRun: null };
    expect(companyEnabled(base, 1)).toBe(true);
    expect(companyEnabled(base, 2)).toBe(false);
    expect(companyEnabled({ ...base, enabled: false }, 1)).toBe(false);
  });
});

describe("v3.9.9 – napi e-mail fejléc", () => {
  it("tegnapi bevétel alatt az előző 30 nap, a készletnél nincs medián-sor", () => {
    const m = renderCompanyMail(pezcar, "ceo");
    expect(m.html).toContain("előző 30 nap: 3,52 m Ft");
    expect(m.html).not.toContain("medián bruttó fedezettel");
    expect(m.html).not.toContain(" M Ft");
  });
});

describe("v3.9.10 – C elrendezés: kiemelt összes pénz, pénztár + bank", () => {
  it("külön bankszámla csempe, arányokkal, a pénztár + bank = összes pénz", () => {
    const r = renderCompanyMail(pezcar, "ceo");
    const m = { html: r.html.replace(/[\u00a0\u202f]/g, " "), text: r.text.replace(/[\u00a0\u202f]/g, " ") };
    expect(m.html).toContain("Bankszámla");
    expect(m.html).toContain("1 943,5 e Ft"); // bank
    expect(m.html).toContain("412,5 e Ft"); // pénztár = 2 356 000 − 1 943 500
    expect(m.html).toContain("18% · forintpénztár");
    expect(m.html).toContain("82% · mai árfolyamon");
    expect(m.text).toContain("bank 1,94 m Ft");
  });
});
