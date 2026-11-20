import { describe, expect, it } from "vitest";
import { buildAnykXml, importEazon, dueDate, familyOf, formFor, kindOf, monthsBetween, parseAnyk, sameTaxpayer, summarize, vatChainIssues, vatResult } from "@/lib/anyk";

// Egy .frm.enyk szerkezete (a mezőértékek kitaláltak)
const ENYK = `<?xml version="1.0" encoding="utf-8"?>
<file>
  <head filetype="zn1810">
    <type>multi</type>
    <saved>20261013205127463</saved>
    <docinfo name="2665 kötegelt nyomtatvány" id="2665" count="2" ver="v.3.49.0" org="NAV" templatever="2.0" tax_number="12345678242" from_date="20260901" to_date="20260930" person_name="Teszt &amp; Társa Kft." krfilename="2665A_12345678242_Teszt_1_1791917487372.kr" />
  </head>
  <nyomtatvanyok xmlns="http://www.apeh.hu/abev/nyomtatvanyok/2005/01" template="NAV_2665_2_0" name="2665 kötegelt nyomtatvány" id="2665">
    <abev><hibakszama>-1</hibakszama><hash> </hash><programverzio>v.3.49.0</programverzio></abev>
    <nyomtatvany sn="0">
      <nyomtatvanyinformacio>
        <nyomtatvanyazonosito>2665A</nyomtatvanyazonosito>
        <nyomtatvanyverzio>2.0</nyomtatvanyverzio>
        <adozo><nev>Teszt &amp; Társa Kft.</nev><adoszam>12345678242</adoszam></adozo>
        <idoszak><tol>20260901</tol><ig>20260930</ig></idoszak>
      </nyomtatvanyinformacio>
      <mezok>
        <mezo eazon="0_0A0001F005A">O</mezo>
        <mezo eazon="0_0A0001I002A">20261013</mezo>
        <mezo eazon="0_0D0001D0082CA">12</mezo>
        <mezo eazon="0_0D0001D0083CA">178</mezo>
        <mezo eazon="0_0D0001D0084CA">178</mezo>
        <mezo eazon="0_0A0001E007A">Teszt &amp; Társa Kft.</mezo>
      </mezok>
    </nyomtatvany>
    <nyomtatvany sn="1">
      <nyomtatvanyinformacio><nyomtatvanyazonosito>2665M</nyomtatvanyazonosito><nyomtatvanyverzio>2.0</nyomtatvanyverzio></nyomtatvanyinformacio>
      <mezok><mezo eazon="0_0BXXXXB005A">Szállító Zrt.</mezo><mezo eazon="0_0BXXXXC0001DA">5081</mezo></mezok>
    </nyomtatvany>
  </nyomtatvanyok>
</file>`;

describe("ÁNYK beolvasás", () => {
  const f = parseAnyk(ENYK);
  it("fej: nyomtatvány, időszak, adózó, mentés, KR", () => {
    expect(f.form).toBe("2665");
    expect(f.from).toBe("2026-09-01");
    expect(f.to).toBe("2026-09-30");
    expect(f.taxNumber).toBe("12345678242");
    expect(f.taxpayerName).toBe("Teszt & Társa Kft.");
    expect(f.savedAt).toBe("2026-10-13T20:51:27");
    expect(f.krFileName).toMatch(/\.kr$/);
  });
  it("lapok és mezők (entitások visszafejtve)", () => {
    expect(f.sheets.map((s) => s.id)).toEqual(["2665A", "2665M"]);
    expect(f.sheets[0].fields["0_0A0001E007A"]).toBe("Teszt & Társa Kft.");
    expect(f.sheets[1].fields["0_0BXXXXC0001DA"]).toBe("5081");
  });
  it("jelleg és ÁFA-eredmény", () => {
    expect(kindOf(f)).toBe("self_revision");
    expect(vatResult(f)).toEqual({ prevCarry: 12, diff: 178, payable: 178, refund: null, carry: null });
    const s = summarize(f);
    expect(s.signedAt).toBe("2026-10-13");
    expect(s.sheetCounts).toEqual({ "2665A": 1, "2665M": 1 });
  });
  it("nem ÁNYK állomány → hiba", () => {
    expect(() => parseAnyk("<root/>")).toThrow();
  });
  it("lapjel → család", () => {
    expect(familyOf("2608M")).toBe("2608");
    expect(familyOf("2565A")).toBe("2565");
  });
});

describe("ÁNYK XML előállítás", () => {
  it("visszaolvasva ugyanaz", () => {
    const f = parseAnyk(ENYK);
    const xml = buildAnykXml({ taxNumber: "12345678-2-42", taxpayerName: f.taxpayerName!, from: f.from!, to: f.to!, sheets: f.sheets });
    expect(xml).toContain('<nyomtatvanyok xmlns="http://www.apeh.hu/abev/nyomtatvanyok/2005/01">');
    expect(xml).toContain("<adoszam>12345678242</adoszam>");
    expect(xml).toContain("Teszt &amp; Társa Kft.");
    const back = parseAnyk(xml);
    expect(back.form).toBe("2665");
    // az import-XML-ben a dinamikus lap XXXX helyett lapsorszámot kap
    expect(back.sheets).toEqual(f.sheets.map((sh) => ({ ...sh, fields: Object.fromEntries(Object.entries(sh.fields).map(([k, v]) => [importEazon(k).replace(/^(?=0[A-Z])/, "0_"), v])) })));
    expect(xml).not.toContain("XXXX");
    expect(xml).not.toMatch(/eazon="\d+_0[A-Z]/);
    expect(back.from).toBe("2026-09-01");
  });
  it("üres mezők kimaradnak", () => {
    const xml = buildAnykXml({ taxNumber: "12345678242", taxpayerName: "X", from: "2026-07-01", to: "2026-07-31", sheets: [{ id: "2608A", fields: { a: "", b: null, c: 0 } }] });
    expect(xml).not.toContain('eazon="a"');
    expect(xml).not.toContain('eazon="b"');
    expect(xml).toContain('<mezo eazon="c">0</mezo>');
  });
});

describe("átviteli lánc", () => {
  const v = (prevCarry: number | null, carry: number | null) => ({ prevCarry, diff: null, payable: null, refund: null, carry });
  it("az előző havi 86. sor a következő hó 82. sorában", () => {
    const issues = vatChainIssues([
      { period: "2026-07", vat: v(null, 71) },
      { period: "2026-08", vat: v(null, null) },
      { period: "2026-09", vat: v(null, null) },
      { period: "2026-02", vat: v(null, 30) },
      { period: "2026-03", vat: v(30, null) },
    ]);
    expect(issues).toEqual([{ period: "2026-08", expected: 71, found: null, prevPeriod: "2026-07" }]);
  });
  it("hiányzó hónapnál nem hasonlít", () => {
    expect(vatChainIssues([{ period: "2026-01", vat: v(null, 5) }, { period: "2026-03", vat: v(null, null) }])).toEqual([]);
  });
});

describe("időszakok és határidők", () => {
  it("ÁFA 20-a, járulék 12-e, hétvégén a következő munkanap", () => {
    expect(dueDate("2665", "2026-10")).toBe("2026-11-20");
    expect(dueDate("2608", "2026-10")).toBe("2026-11-12");
    expect(dueDate("2665", "2026-08")).toBe("2026-09-21"); // 09.20. vasárnap
    expect(dueDate("2565", "2025-12")).toBe("2026-01-20");
  });
  it("nyomtatvány az év szerint", () => {
    expect(formFor("vat", "2025-07")).toBe("2565");
    expect(formFor("vat", "2026-01")).toBe("2665");
    expect(formFor("payroll", "2026-07")).toBe("2608");
  });
  it("hónapok", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("adózó egyezése a törzsszám alapján", () => {
    expect(sameTaxpayer("32811902-2-07", "32811902207")).toBe(true);
    expect(sameTaxpayer("32811902207", "12345678242")).toBe(false);
  });
});

describe("importEazon", () => {
  it("dinamikus lap XXXX → lapsorszám", async () => {
    const { importEazon } = await import("@/lib/anyk");
    expect(importEazon("0_0BXXXXC0001AA")).toBe("0B0001C0001AA");
    expect(importEazon("2_0BXXXXC0037CA")).toBe("0B0003C0037CA");
    expect(importEazon("0_0HXXXXB001A")).toBe("0H0001B001A");
    expect(importEazon("0_0A0001C001A")).toBe("0A0001C001A");
    expect(importEazon("0_26358")).toBe("0_26358");
  });
});

describe("M-lap alnyomtatvány", () => {
  it("albizonylatazonositas a partnerrel", () => {
    const xml = buildAnykXml({ taxNumber: "12345678242", taxpayerName: "X", from: "2026-10-01", to: "2026-10-31", sheets: [
      { id: "2665A", fields: { "0_0A0001C001A": "12345678242" } },
      { id: "2665M", fields: { "0_0A0001C005A": "12229132", "0_0A0001C006A": "Bárdi Autó Zrt.", "0_0BXXXXC0001AA": "SZ-1", "1_0BXXXXC0001AA": "SZ-2" } },
    ] });
    expect(xml).toContain("<azonosito>12229132</azonosito>");
    expect(xml).toContain("<megnevezes>Bárdi Autó Zrt.</megnevezes>");
    expect(xml.match(/<albizonylatazonositas>/g)).toHaveLength(1);
    expect(xml).toContain('<mezo eazon="0B0001C0001AA">SZ-1</mezo>');
    expect(xml).toContain('<mezo eazon="0B0002C0001AA">SZ-2</mezo>');
    expect(xml.indexOf("</albizonylatazonositas>")).toBeLessThan(xml.lastIndexOf("<idoszak>"));
  });
});

describe("ÁNYK-mentés (.frm.enyk)", () => {
  it("az ÁNYK saját mentésének formája, visszaolvasható", async () => {
    const { buildAnykEnyk } = await import("@/lib/anyk");
    const sheets = [
      { id: "2665A", fields: { "0_0A0001C001A": "12345678242", "0_0HXXXXB001A": "1" } },
      { id: "2665M", fields: { "0_0A0001C005A": "12229132", "0_0A0001C006A": "Bárdi Autó Zrt.", "0_0BXXXXC0001AA": "SZ-1", "1_0BXXXXC0001AA": "SZ-2" } },
    ];
    const e = buildAnykEnyk({ form: "2665", taxNumber: "12345678-2-42", taxpayerName: "Teszt Kft.", from: "2026-10-01", to: "2026-10-31", sheets });
    expect(e).toContain('<head filetype="zn1810">');
    expect(e).toContain('templatever="2.0"');
    expect(e).toContain('template="NAV_2665_2_0"');
    expect(e).toContain('count="2"');
    expect(e).toContain('<nyomtatvany sn="1">');
    expect(e).toContain("<azonosito>12229132</azonosito>");
    expect(e).toContain('eazon="1_0BXXXXC0001AA"');
    const back = parseAnyk(e);
    expect(back.form).toBe("2665");
    expect(back.sheets.map((x) => x.fields)).toEqual(sheets.map((x) => x.fields));
  });
});
