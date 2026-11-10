import { describe, expect, it } from "vitest";
import { amountsIn, datesIn, parseAmount, parseDocumentText, parseStatementTable } from "@/lib/inbox/rules";
import { parseCsv } from "@/lib/inbox/text";

const MMCT = { name: "MM CAR TRADE Kft.", taxNumber: "32555666-2-13" };

describe("számok és dátumok", () => {
  it("magyar, német és angol összegformátum", () => {
    expect(parseAmount("16 447")).toBe(16447);
    expect(parseAmount("1.234.567,50")).toBe(1234567.5);
    expect(parseAmount("3.250,00")).toBe(3250);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("-3 150")).toBe(-3150);
    expect(parseAmount("12446")).toBe(12446);
  });
  it("a sor összegei dátum, adószám és százalék nélkül", () => {
    expect(amountsIn("Polírozás ABC-123  2 db  4 900  9 800 27%  2 646  12 446")).toEqual([2, 4900, 9800, 2646, 12446]);
    expect(amountsIn("Adószám: 11223344-2-07 2026.11.09.")).toEqual([]);
  });
  it("dátumformátumok", () => {
    expect(datesIn("Kelte: 2026.11.09.  Határidő: 18.09.2026")).toEqual(["2026-11-09", "2026-09-18"]);
    expect(datesIn("2026. november 3.")).toEqual(["2026-11-03"]);
  });
});

const SZAMLAZZ = `SZÁMLA
Számla sorszáma: PM-2026/118
Eladó  Vevő
Polírmester Kft.  MM CAR TRADE Kft.
1111 Budapest, Fő utca 1.  2000 Szentendre, Kossuth u. 2.
Adószám: 11223344-2-07  Adószám: 32555666-2-13
Fizetési mód  Teljesítés dátuma  Számla kelte  Fizetési határidő
Készpénz  2026.11.09.  2026.11.08.  2026.11.10.
Megnevezés  Menny. Egység Nettó egységár Nettó ár ÁFA ÁFA érték Bruttó ár
Polírozás ABC-123  2 db  4 900  9 800 27%  2 646  12 446
Fényszóró polírozás  1 db  3 150  3 150 27%  851  4 001
ÁFA kulcs  Nettó  ÁFA  Bruttó
27%  12 950  3 497  16 447
Fizetendő:  16 447 Ft`;

describe("számla szövegéből (AI nélkül)", () => {
  it("számlázz.hu-szerű bejövő számla: partner, dátumok a fejléc-oszlopokból, tételek", () => {
    const x = parseDocumentText(SZAMLAZZ, MMCT);
    expect(x.direction).toBe("in");
    expect(x.seller?.name).toBe("Polírmester Kft.");
    expect(x.seller?.taxNumber).toBe("11223344-2-07");
    expect(x.invoiceNumber).toBe("PM-2026/118");
    expect([x.fulfillmentDate, x.issueDate, x.dueDate]).toEqual(["2026-11-09", "2026-11-08", "2026-11-10"]);
    expect(x.paymentMethod).toBe("cash");
    expect(x.lines).toHaveLength(2);
    expect(x.lines?.[0]).toMatchObject({ net: 9800, vat: 2646, gross: 12446, vatRate: 27, quantity: 2 });
    expect(x.totals).toEqual({ net: 12950, vat: 3497, gross: 16447 });
    expect(x.confidence).toBe(1);
  });

  it("AUTO1 német/angol, EUR, különbözeti, alvázszám", () => {
    const t = `AUTO1 European Cars B.V. · Hauptstraße 5, 10827 Berlin · USt-IdNr. DE301234567
Rechnung / Invoice
Rechnungsnummer / Invoice number: BC60712
Rechnungsdatum / Invoice date:  18.09.2026
Kunde: MM CAR TRADE Kft., Kossuth u. 2, 2000 Szentendre, Hungary, VAT HU32555666
Mitsubishi Lancer 1.5 FIN: JMBSNCY3A8U012345  3.250,00 €
Differenzbesteuerung gem. § 25a UStG / margin scheme
Gesamtbetrag / Total amount: 3.250,00 EUR
Zahlbar bis: 25.09.2026 per Überweisung`;
    const x = parseDocumentText(t, MMCT);
    expect(x.direction).toBe("in");
    expect(x.seller?.euVat).toBe("DE301234567");
    expect(x.invoiceNumber).toBe("BC60712");
    expect(x.currency).toBe("EUR");
    expect(x.totals?.gross).toBe(3250);
    expect(x.lines?.[0]).toMatchObject({ vatType: "KÜL", net: 3250 });
    expect(x.vehicle?.vin).toBe("JMBSNCY3A8U012345");
    expect(x.dueDate).toBe("2026-09-25");
    expect(x.paymentMethod).toBe("transfer");
  });

  it("időszakos számla és saját kimenő számla iránya", () => {
    const per = parseDocumentText(`Használtautó.hu Kft.\nAdószám: 14567890-2-41\nSzámlaszám: P2026/31877\nVevő: MM CAR TRADE Kft. Adószám: 32555666-2-13\nSzámla kelte: 2026.11.01. Teljesítés: 2026.11.30.\nElszámolási időszak: 2026.11.01. - 2026.11.30.\nHirdetés  1  15 000  15 000 27%  4 050  19 050\nÖsszesen fizetendő: 19 050 HUF`, MMCT);
    expect(per.periodic).toBe(true);
    expect(per.fulfillmentDate).toBe("2026-11-30");
    const out = parseDocumentText(`Számla\nEladó: MM CAR TRADE Kft. Adószám: 32555666-2-13\nVevő: Berkes Autó Kft. Adószám: 22334455-2-13\nSzámlaszám: MM-2026-3\nKelte: 2026.11.05.\nKülönbözeti adózás - használt cikkek\nMazda 3  3 950 000\nFizetendő: 3 950 000 Ft`, MMCT);
    expect(out.direction).toBe("out");
    expect(out.buyer?.taxNumber).toBe("22334455-2-13");
    expect(out.lines?.[0].vatType).toBe("KÜL");
  });

  it("díjbekérő és sztornó felismerése", () => {
    expect(parseDocumentText("DÍJBEKÉRŐ\nSorszám: D-12", MMCT).docType).toBe("proforma");
    expect(parseDocumentText("SZTORNÓ SZÁMLA\nSorszám: S-1", MMCT).docType).toBe("credit_note");
  });
});

describe("bankkivonat-export", () => {
  it("fejléces CSV (pontosvessző, magyar oszlopnevek, T/J)", () => {
    const rows = parseCsv(`Könyvelés dátuma;Értéknap;Összeg;Pénznem;T/J;Partner neve;Partner számlaszáma;Közlemény
2026.11.03;2026.11.03;19 050;HUF;T;Használtautó.hu Kft.;10918001-00000068-12345678;P2026/30264
2026.11.04;2026.11.04;1 250;HUF;T;;;Számlavezetési díj
2026.11.05;2026.11.05;3 950 000;HUF;J;Berkes Mónika;11773016-11111111;MM-2026-2 vételár`);
    const x = parseStatementTable(rows);
    expect(x.statement?.transactions).toHaveLength(3);
    expect(x.statement?.transactions[0]).toMatchObject({ date: "2026-11-03", amount: -19050, counterparty: "Használtautó.hu Kft.", description: "P2026/30264" });
    expect(x.statement?.transactions[2].amount).toBe(3950000);
  });

  it("fejléc nélküli export (oszlopok tartalom alapján)", () => {
    const rows = parseCsv(`"11773016-12345678";"T";"-19050";"HUF";"20261103";"20261103";"10918001-00000068";"Használtautó.hu Kft.";"P2026/30264"
"11773016-12345678";"J";"400000";"HUF";"20261105";"20261105";"11773016-11111111";"Mogyorósi Bálint";"tagi kölcsön"`);
    const x = parseStatementTable(rows);
    expect(x.statement?.transactions.map((t) => [t.date, t.amount, t.counterparty])).toEqual([
      ["2026-11-03", -19050, "Használtautó.hu Kft."],
      ["2026-11-05", 400000, "Mogyorósi Bálint"],
    ]);
  });

  it("külön terhelés / jóváírás oszlop", () => {
    const x = parseStatementTable([["Dátum", "Leírás", "Terhelés", "Jóváírás", "Egyenleg"], ["2026-11-02", "Kártyás vásárlás OMV", "12 000", "", "88 000"], ["2026-11-03", "Befizetés", "", "50 000", "138 000"]]);
    expect(x.statement?.transactions.map((t) => t.amount)).toEqual([-12000, 50000]);
  });
});
