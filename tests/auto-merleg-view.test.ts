import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoMerlegView } from "@/components/AutoMerleg";
import type { MerlegInput } from "@/lib/auto-merleg-calc";

const input: MerlegInput = {
  today: "2026-11-20", buyMode: "margin", sellMode: "margin", buy: 2_900_000, purchaseDate: "2026-09-02",
  costs: [{ label: "Fényezés", date: "2026-09-10", amount: 220_000 }], epr: 36_720, sale: null,
  plan: { price: 3_699_000, date: "2026-10-15", costs: [{ label: "Fényezés", date: null, amount: 200_000 }] },
  holding: { ratePct: 8, fixPerDay: 250 }, target: 300_000, peers: { label: "Suzuki Swift", count: 5, medF2: 260_000, medDays: 41 },
};
const meta = { vehicleId: 7, title: "Suzuki Swift", year: 2019, plate: "ABC-123", vin: "TSMX", status: "in_stock", seller: "Kiss Péter", vatTreatment: "margin" as const, purchaseDate: "2026-09-02", saleDate: null, buyer: null, hasMarginCard: true, eprNote: null, checks: [], origin: null };

describe("AutóMérleg nézet", () => {
  it("tartási költség javaslat a könyvelésből", () => {
    const suggestion = { from: "2025-11-20", to: "2026-11-20", days: 366, avgStock: 8, parts: [{ code: "522", label: "Bérleti díjak (telephely)", amount: 2_400_000 }, { code: "524", label: "Hirdetés, reklám", amount: 600_000 }, { code: "533", label: "Biztosítási díjak", amount: 300_000 }],
      fixedTotal: 3_300_000, fixPerDay: 1130, interest: 0, avgCapital: 25_000_000, financingPct: null, opportunityPct: 6.5, moneyPct: 6.5, slipPct: 3, slipCars: 1, slipFromData: false, ratePct: 9.5 };
    const h = renderToStaticMarkup(createElement(AutoMerlegView, { input, meta, cid: 1, canWrite: true, saveHolding: async () => {}, suggestion }));
    expect(h).toContain("Javaslat a könyvelésből");
    expect(h).toContain("9,5 %/év");
    expect(h).toContain("Javaslat átvétele");
  });
  it("készleten és eladva is renderelődik", () => {
    const a = renderToStaticMarkup(createElement(AutoMerlegView, { input, meta, cid: 1, canWrite: true, saveHolding: async () => {} }));
    expect(a).toContain("Várható nettó fedezet");
    expect(a).toContain("Árazás az ÁrSugóban");
    expect(a).toContain("Terv kontra tény");
    const b = renderToStaticMarkup(createElement(AutoMerlegView, { input: { ...input, sale: { date: "2026-10-28", gross: 3_690_000, vat: 167_953 } }, meta: { ...meta, status: "sold", saleDate: "2026-10-28" }, cid: 1, canWrite: false, saveHolding: async () => {} }));
    expect(b).toContain("Napi fedezet");
    expect(b).not.toContain("Árazás az ÁrSugóban");
  });
});
