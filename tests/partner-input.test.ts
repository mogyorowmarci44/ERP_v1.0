import { describe, expect, it } from "vitest";
import { cleanPartnerInput, findDuplicatePartner, huAdoazonositoValid, huTorzsszamValid, normalizeHuTaxNumber } from "@/lib/partner-input";

describe("magyar adószám", () => {
  it("normalizál és ellenőriz", () => {
    expect(normalizeHuTaxNumber("10773381244")).toBe("10773381-2-44");
    expect(normalizeHuTaxNumber("10773381-2-44")).toBe("10773381-2-44");
    expect(normalizeHuTaxNumber("1077338")).toBeNull();
    expect(huTorzsszamValid("10773381")).toBe(true);
    expect(huTorzsszamValid("10773382")).toBe(false);
  });
  it("adóazonosító jel", () => {
    expect(huAdoazonositoValid("8000000008")).toBe(true);
    expect(huAdoazonositoValid("8000000007")).toBe(false);
  });
});

describe("cleanPartnerInput", () => {
  it("HU cég: adószám kötelező és normalizált", () => {
    expect(() => cleanPartnerInput({ name: "Teszt Kft" })).toThrow(/kötelező/);
    const c = cleanPartnerInput({ name: "  Teszt   Kft ", taxNumber: "10773381 2 44", country: "hu" });
    expect(c).toMatchObject({ name: "Teszt Kft", taxNumber: "10773381-2-44", country: "HU", isPrivatePerson: false });
  });
  it("hibás ellenőrző számjegy / ÁFA-kód", () => {
    expect(() => cleanPartnerInput({ name: "X", taxNumber: "10773382-2-44" })).toThrow(/törzsszám/);
    expect(() => cleanPartnerInput({ name: "X", taxNumber: "10773381-7-44" })).toThrow(/ÁFA-kód/);
  });
  it("szerkesztéskor (requireHuTax: false) adószám nélkül is menthető", () => {
    expect(cleanPartnerInput({ name: "Régi Kft" }, { requireHuTax: false }).taxNumber).toBeNull();
  });
  it("magánszemély: adószám nem kötelező, adóazonosító elfogadva", () => {
    expect(cleanPartnerInput({ name: "Kiss Péter", isPrivatePerson: true }).taxNumber).toBeNull();
    expect(cleanPartnerInput({ name: "Kiss Péter", isPrivatePerson: true, taxNumber: "8000000008" }).taxNumber).toBe("8000000008");
  });
  it("külföldi partner: közösségi adószám formátum", () => {
    const c = cleanPartnerInput({ name: "Auto GmbH", country: "de", euVatNumber: "de 123 456 789" });
    expect(c).toMatchObject({ country: "DE", euVatNumber: "DE123456789", taxNumber: null });
    expect(() => cleanPartnerInput({ name: "Auto GmbH", country: "DE", euVatNumber: "123456789" })).toThrow(/országkóddal/);
  });
});

describe("findDuplicatePartner", () => {
  const list = [
    { id: 1, name: "Teszt Kft", taxNumber: "10773381-2-44", euVatNumber: "HU10773381" },
    { id: 2, name: "Auto GmbH", taxNumber: null, euVatNumber: "DE123456789" },
    { id: 3, name: "Kiss Péter", taxNumber: null, euVatNumber: null },
  ];
  it("törzsszám alapján (más ÁFA-kód / megye is ugyanaz a cég)", () => {
    expect(findDuplicatePartner(list, { name: "Más név", taxNumber: "10773381-1-42", euVatNumber: null })?.id).toBe(1);
  });
  it("közösségi adószám alapján", () => {
    expect(findDuplicatePartner(list, { name: "Auto", taxNumber: null, euVatNumber: "DE123456789" })?.id).toBe(2);
  });
  it("adószám nélkül név alapján", () => {
    expect(findDuplicatePartner(list, { name: "kiss péter", taxNumber: null, euVatNumber: null })?.id).toBe(3);
    expect(findDuplicatePartner(list, { name: "Nagy Anna", taxNumber: null, euVatNumber: null })).toBeUndefined();
  });
});
