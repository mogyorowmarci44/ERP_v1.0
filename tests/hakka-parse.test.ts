import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { parseExemption, parseRate, hufAmounts, parseHakkaFiles } from "@/lib/hakka-parse";

const norm = (s: string) => s.toLocaleLowerCase("hu-HU").replace(/városi|önkormányzat(a)?|község/g, "").replace(/\s+/g, " ").trim();

describe("HAKKA – szövegek értelmezése", () => {
  it("mentességi határ: „nem éri el” → kizáró, „nem haladja meg” → befoglaló", () => {
    expect(parseExemption("Mentesek az iparűzési adó megfizetése alól azok a vállalkozások, amelyek vállalkozás szintű adóalapja nem éri el a 2.500.000,- Ft-ot.")).toEqual({ below: 2_500_000, inclusive: false });
    expect(parseExemption("akinek számított adóalapja nem haladja meg az 2 500 000 Ft-ot, mentesül")).toEqual({ below: 2_500_000, inclusive: true });
    expect(parseExemption("Vállalkozás szintű adóalap kisebb mint 1.200.000,- Ft.")).toEqual({ below: 1_200_000, inclusive: false });
  });
  it("háziorvos / védőnő mentesség és azonosítók nem számítanak", () => {
    expect(parseExemption("háziorvos, védőnő: adóalapja nem haladja meg a 20 millió Ft-ot")).toBeNull();
    expect(parseExemption("27/2018. rendelet 2014.01.01 ID 1019648 adóalap nem éri el")).toBeNull();
    expect(hufAmounts("2014.01.01 · 1019648 · 500.000 Ft")).toEqual([500_000]);
  });
  it("mérték", () => {
    expect(parseRate("2")).toBe(0.02);
    expect(parseRate("1,4 %")).toBe(0.014);
    expect(parseRate("0,02")).toBe(0.02);
    expect(parseRate("5000 Ft/nap")).toBeNull();
    expect(parseRate("100%")).toBeNull();
  });
});

describe("HAKKA – fájlok feldolgozása", () => {
  const aoa = [
    ["Önkormányzat neve", "Adónem", "Típus", "Leírás", "Mérték"],
    ["Mór Városi Önkormányzat", "Helyi iparűzési adó (állandó jelleg)", "adómérték", "", "2"],
    ["Mór Városi Önkormányzat", "Helyi iparűzési adó (állandó jelleg)", "alanyi adóalap mentesség", "Mentesek, amelyek vállalkozás szintű adóalapja nem éri el a 2.500.000,- Ft-ot.", "100%"],
    ["Mór Városi Önkormányzat", "Helyi iparűzési adó (ideiglenes jelleg)", "adómérték", "", "5000 Ft/nap"],
    ["Ajka Város Önkormányzata", "Helyi iparűzési adó (állandó jelleg)", "adómérték", "", "2"],
    ["Ajka Város Önkormányzata", "Helyi iparűzési adó (állandó jelleg)", "mentesség", "adóalapja az 500.000 Ft-ot nem haladja meg", "100%"],
    ["Kisfalu Község Önkormányzata", "Helyi iparűzési adó (állandó jelleg)", "adómérték", "", "1,5"],
    ["Kisfalu Község Önkormányzata", "Építményadó", "adómérték", "", "1000"],
  ];
  const makeXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("HIPA");
    ws.addRow(["Települési adók – 2026. november"]); // cím-sor a fejléc fölött
    for (const r of aoa) ws.addRow(r);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  };

  it("xlsx egy zipben → településenkénti szabály", async () => {
    const xlsx = await makeXlsx();
    const zip = zipSync({ "helyiadok_2026_11.xlsx": xlsx, "olvass.txt": strToU8("info") });
    const r = await parseHakkaFiles([{ name: "letoltes.zip", data: zip }], norm, "Kincstár (HAKKA) 2026-11");
    expect(r.rules[norm("Mór Városi Önkormányzat")]).toMatchObject({ rate: 0.02, exemptBelow: 2_500_000, exemptInclusive: false });
    expect(r.rules[norm("Ajka Város Önkormányzata")]).toMatchObject({ rate: 0.02, exemptBelow: 500_000, exemptInclusive: true });
    expect(r.rules[norm("Kisfalu Község Önkormányzata")]).toMatchObject({ rate: 0.015, exemptBelow: null });
    expect(r.withExemption).toBe(2);
    expect(r.diagnostics.some((d) => d.includes("zip"))).toBe(true);
  });
  it("CSV (pontosvessző, Windows-1250 is)", async () => {
    const csv = aoa.map((r) => r.join(";")).join("\n");
    const r = await parseHakkaFiles([{ name: "adat.csv", data: strToU8(csv) }], norm, "x");
    expect(r.rules[norm("Mór Városi Önkormányzat")]?.exemptBelow).toBe(2_500_000);
  });
  it("CSV idézőjeles mezőkkel (vessző az értékben), CRLF", async () => {
    const csv = aoa.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const r = await parseHakkaFiles([{ name: "adat.csv", data: strToU8(csv) }], norm, "x");
    expect(r.rules[norm("Mór Városi Önkormányzat")]).toMatchObject({ rate: 0.02, exemptBelow: 2_500_000 });
    expect(r.rules[norm("Kisfalu Község Önkormányzata")]?.rate).toBe(0.015);
  });
  it("régi .xls: érthető üzenet, nem hiba", async () => {
    const r = await parseHakkaFiles([{ name: "regi.xls", data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }], norm, "x");
    expect(r.diagnostics.some((d) => d.includes("xlsx-ként"))).toBe(true);
  });
});
