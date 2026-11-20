import { describe, expect, it } from "vitest";
import { build2608Sheets } from "@/lib/payroll-2608";
import { buildAnykXml, type AnykSheet } from "@/lib/anyk";

const template: AnykSheet[] = [
  { id: "2608A", version: "6.0", fields: { "0_0A0001C002A": "12345678242", "0_0A0001C027A": "20260701", "0_0A0001C028A": "20260731", "0_0C0001C0028CA": "42", "0_24968": "x", "0_0DXXXXB001A": "1" } },
  { id: "2608M", version: "6.0", fields: {
    "0_0A0001C007A": "8000000000", "0_0A0001C017A": "Teszt", "0_0A0001C018A": "Elek", "0_0A0001C027A": "19970612",
    "0_0A0001E001A": "20260701", "0_0A0001E002A": "20260731", "0_0FXXXXC001A": "20260701", "0_0FXXXXD0520BA": "20260701", "0_0FXXXXD0520CA": "20260731",
    "0_0IXXXXD0626CA": "322800", "0_0IXXXXD0629CA": "59718", "0_0E0001E0386CA": "41964", "0_25122": "Teszt Elek",
  } },
];

describe("2608 sablonból", () => {
  it("időszak és összegek átírva, segédmezők nélkül", () => {
    const r = build2608Sheets({ template, templateFrom: "2026-07-01", templateTo: "2026-07-31", from: "2026-08-01", to: "2026-08-31",
      people: [{ taxId: "8000000000", name: "Teszt Elek", tbBase: 373200, tb: 69042, szochoBase: 373200, szocho: 48516 }] });
    const [a, m] = r.sheets;
    expect(a.fields["0_0A0001C027A"]).toBe("20260801");
    expect(a.fields["0_0A0001C028A"]).toBe("20260831");
    expect(a.fields["0_24968"]).toBeUndefined();
    expect(a.fields["0_0C0001C0028CA"]).toBe("49");
    expect(a.fields["0_0F0001C0160CA"]).toBe("69042");
    expect(m.fields["0_0A0001C027A"]).toBe("19970612");
    expect(m.fields["0_0FXXXXD0520BA"]).toBe("20260801");
    expect(m.fields["0_0FXXXXD0520CA"]).toBe("20260831");
    expect(m.fields["0_0IXXXXD0626CA"]).toBe("373200");
    expect(m.fields["0_0E0001E0386CA"]).toBe("48516");
    const xml = buildAnykXml({ taxNumber: "12345678242", taxpayerName: "X", from: "2026-08-01", to: "2026-08-31", sheets: r.sheets });
    expect(xml).toContain("<adoazonosito>8000000000</adoazonosito>");
    expect(xml).toContain("<nev>Teszt Elek</nev>");
    expect(xml).toContain('<mezo eazon="0I0001D0626CA">373200</mezo>');
    expect(xml).toContain("<nyomtatvanyverzio>6.0</nyomtatvanyverzio>");
  });
  it("sablonban nem szereplő személy → figyelmeztetés", () => {
    const r = build2608Sheets({ template, templateFrom: "2026-07-01", templateTo: "2026-07-31", from: "2026-08-01", to: "2026-08-31",
      people: [{ taxId: "", name: "Valaki Más", tbBase: 1, tb: 1, szochoBase: 1, szocho: 1 }] });
    expect(r.warnings.length).toBe(1);
    expect(r.sheets).toHaveLength(1);
  });
});
