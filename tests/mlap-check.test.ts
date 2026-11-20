import { describe, expect, it } from "vitest";
import { compareMSheets, type ErpInvoice, type SubmittedRow } from "@/lib/mlap-compare";

const S = (x: Partial<SubmittedRow>): SubmittedRow => ({ period: "2025-09", number: "X", date: "2025-09-05", base: 1000, vat: 270, tax8: "12229132", partnerName: "Bárdi Autó Zrt.", ...x });
const E = (x: Partial<ErpInvoice>): ErpInvoice => ({ id: 1, number: "X", date: "2025-09-05", partnerId: 1, partnerName: "Bárdi Autó Zrt.", tax8: "12229132", base: 1000, vat: 270, deductibleVat: 270, kinds: ["normal"], ...x });

describe("M-lap összevetés", () => {
  it("pontos egyezés levonható számlával → nincs teendő", () => {
    expect(compareMSheets([S({ number: "6TM5-014311" })], [E({ number: "6TM5-014311" })])).toEqual([]);
  });
  it("az ERP-ben nem levonható", () => {
    const r = compareMSheets([S({ number: "A1" })], [E({ number: "A1", deductibleVat: 0, kinds: ["non_deductible"] })]);
    expect(r[0].type).toBe("not_deductible");
  });
  it("csak írásmódban tér el (kis-nagybetű, kötőjel)", () => {
    const r = compareMSheets([S({ number: "6tm5-014357" })], [E({ number: "6TM5014357" })]);
    expect(r[0]).toMatchObject({ type: "number_mismatch", hint: "írásmód" });
  });
  it("elírt / levágott szám – partner és összeg alapján", () => {
    const r = compareMSheets([S({ number: "HERM0591/2025", base: 19685, vat: 5315, tax8: "20346098", partnerName: "Hermann Kulcs-Zárda Bt." })],
      [E({ id: 7, number: "HERM0591/202", base: 19685, vat: 5315, tax8: null, partnerName: "Herman Kulcs-Zárda Bt." })]);
    expect(r[0]).toMatchObject({ type: "number_mismatch", hint: "összeg és partner alapján" });
  });
  it("nincs párja", () => {
    expect(compareMSheets([S({ number: "ZZZ", vat: 999 })], [E({ number: "Y" })])[0].type).toBe("missing");
  });
});
