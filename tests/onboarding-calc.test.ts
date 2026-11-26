import { describe, expect, it } from "vitest";
import { accountTypeOf, amount, parseAccounts, parseCsv, parseOpening, parsePartners } from "../src/lib/onboarding-calc";

describe("bevezetés – importok értelmezése (v6.5.0)", () => {
  it("összegek magyar és angol írásmóddal", () => {
    expect(amount("1 234 567,89")).toBe(1234567.89);
    expect(amount("1,234,567.89")).toBe(1234567.89);
    expect(amount("1.234.567,89")).toBe(1234567.89);
    expect(amount("-1500")).toBe(-1500);
    expect(amount("(2 000)")).toBe(-2000);
    expect(amount("12,5")).toBe(12.5);
    expect(amount("")).toBe(0);
    expect(amount(3000)).toBe(3000);
    expect(amount("500 000 Ft")).toBe(500000);
  });

  it("számlatípus a számlaszámból", () => {
    expect(accountTypeOf("384")).toBe("asset");
    expect(accountTypeOf("411")).toBe("equity");
    expect(accountTypeOf("454")).toBe("liability");
    expect(accountTypeOf("529")).toBe("expense");
    expect(accountTypeOf("911")).toBe("revenue");
    expect(accountTypeOf("0")).toBe("off_balance");
  });

  it("nyitómérleg: rugalmas fejléc, egyenleg oszlop, negatív előjel, egyezés", () => {
    const r = parseOpening([
      { "Főkönyvi számla": "384", Megnevezés: "Bank", Tartozik: "1 500 000", Követel: "" },
      { "Főkönyvi számla": "311", Megnevezés: "Vevők", Tartozik: "200 000", Követel: "", Partner: "Vevő Kft" },
      { "Főkönyvi számla": "411", Megnevezés: "Jegyzett tőke", Tartozik: "", Követel: "3 000 000" },
      { "Főkönyvi számla": "413", Megnevezés: "Eredménytartalék", Tartozik: "1 300 000", Követel: "" },
      { "Főkönyvi számla": "", Megnevezés: "Összesen", Tartozik: "3 000 000", Követel: "3 000 000" },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(4);
    expect(r.items[1]).toMatchObject({ code: "311", debit: 200000, partner: "Vevő Kft" });
    expect(r.totalDebit).toBe(3000000);

    const b = parseOpening([{ Számla: "384", Egyenleg: "100" }, { Számla: "454", Egyenleg: "-100" }]);
    expect(b.errors).toEqual([]);
    expect(b.items[1]).toMatchObject({ debit: 0, credit: 100 });
  });

  it("nyitómérleg: hibák (nem egyezik, rossz számlaszám, üres)", () => {
    expect(parseOpening([{ Számla: "384", Tartozik: 100 }]).errors[0]).toMatch(/nem egyezik/);
    expect(parseOpening([{ Számla: "Bank", Tartozik: 100 }]).errors[0]).toMatch(/nem főkönyvi/);
    expect(parseOpening([{ Valami: 1 }]).errors[0]).toMatch(/Nem találtam/);
  });

  it("számlatükör: típus felismerése, duplikátum", () => {
    const r = parseAccounts([{ Kód: "3841", Megnevezés: "EUR bankszámla" }, { Kód: "529", Megnevezés: "Egyéb", Típus: "költség" }, { Kód: "3841", Megnevezés: "x" }]);
    expect(r.items.map((x) => x.type)).toEqual(["asset", "expense"]);
    expect(r.errors[0]).toMatch(/kétszer/);
  });

  it("partnerek és CSV (pontosvessző, idézőjel)", () => {
    const rows = parseCsv('﻿Név;Adószám;Magánszemély\n"Teszt; Kft";12345678-2-41;nem\nKiss Anna;;igen\n');
    const p = parsePartners(rows);
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ name: "Teszt; Kft", taxNumber: "12345678-2-41", isPrivatePerson: false, country: "HU" });
    expect(p.items[1].isPrivatePerson).toBe(true);
  });
});
