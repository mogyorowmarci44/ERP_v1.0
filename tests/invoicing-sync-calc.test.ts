import { describe, it, expect } from "vitest";
import { parseSzamlazzResponse, szamlazzQueryXml, splitInvoiceNumber, rollYear, fromBillingo, billingoWanted, vatOf, paymentOf } from "@/lib/invoicing-sync-calc";
import { vatCodeFor } from "@/lib/inbox/propose";

const SZ = `<?xml version="1.0" encoding="UTF-8"?>
<szamla xmlns="http://www.szamlazz.hu/szamla">
  <szallito><nev>MM Car Trade Kft.</nev><adoszam>12345678-2-02</adoszam><cim><orszag>Magyarország</orszag><irsz>7900</irsz><telepules>Szigetvár</telepules><cim>Fő u. 1.</cim></cim></szallito>
  <alap><id>991</id><szamlaszam>E-MMCT-2026-42</szamlaszam><tipus>SZ</tipus><kelt>2026-11-20</kelt><telj>2026-11-19</telj><fizh>2026-11-28</fizh><fizmod>Átutalás</fizmod><devizanem>Ft</devizanem></alap>
  <vevo><nev>Kovács Bt.</nev><adoszam>87654321-1-02</adoszam><cim><orszag>HU</orszag><irsz>7621</irsz><telepules>Pécs</telepules><cim>Király u. 5.</cim></cim></vevo>
  <tetelek>
    <tetel><nev>Fényezés</nev><mennyiseg>1</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg><nettoegysegar>100000</nettoegysegar><afakulcs>27</afakulcs><netto>100000</netto><afa>27000</afa><brutto>127000</brutto></tetel>
    <tetel><nev>Használt autó</nev><mennyiseg>1</mennyiseg><nettoegysegar>2000000</nettoegysegar><afakulcs>K.AFA</afakulcs><netto>2000000</netto><afa>0</afa><brutto>2000000</brutto></tetel>
  </tetelek>
  <osszegek><totalossz><netto>2100000</netto><afa>27000</afa><brutto>2127000</brutto></totalossz></osszegek>
  <pdf>JVBERi0xLjQK</pdf>
</szamla>`;

describe("számlázz.hu", () => {
  it("lekérdező XML: kulcs, sorszám, PDF, escape", () => {
    const x = szamlazzQueryXml("k<ey", "E-A-2026-1");
    expect(x).toContain("<szamlaagentkulcs>k&lt;ey</szamlaagentkulcs>");
    expect(x).toContain("<szamlaszam>E-A-2026-1</szamlaszam>");
    expect(x).toContain("<pdf>true</pdf>");
  });

  it("válasz → kiolvasott kimenő számla", () => {
    const r = parseSzamlazzResponse(SZ);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const x = r.extracted;
    expect(x.direction).toBe("out");
    expect(x.docType).toBe("invoice");
    expect(x.invoiceNumber).toBe("E-MMCT-2026-42");
    expect(x.fulfillmentDate).toBe("2026-11-19");
    expect(x.dueDate).toBe("2026-11-28");
    expect(x.currency).toBe("HUF");
    expect(x.paymentMethod).toBe("transfer");
    expect(x.buyer).toMatchObject({ name: "Kovács Bt.", taxNumber: "87654321-1-02", privatePerson: false, address: "7621 Pécs Király u. 5." });
    expect(x.lines).toHaveLength(2);
    expect(x.lines![0]).toMatchObject({ net: 100000, vatRate: 27, vat: 27000 });
    expect(vatCodeFor(x.lines![0].vatType, x.lines![0].vatRate)).toBe("27");
    expect(vatCodeFor(x.lines![1].vatType, x.lines![1].vatRate)).toBe("KÜL27");
    expect(x.totals).toEqual({ net: 2100000, vat: 27000, gross: 2127000 });
    expect(r.pdf).toBe("JVBERi0xLjQK");
    expect(x.method).toBe("table");
  });

  it("egytételes számla (nem tömb), magánszemély vevő, sztornó", () => {
    const xml = `<szamla><alap><szamlaszam>A-2026-3</szamlaszam><tipus>SS</tipus><kelt>2026-01-02</kelt><fizmod>Készpénz</fizmod><devizanem>EUR</devizanem><hivszamlaszam>A-2026-2</hivszamlaszam></alap>
      <vevo><nev>Nagy Péter</nev></vevo><tetelek><tetel><nev>Szerviz</nev><netto>-100</netto><afakulcs>27</afakulcs><afa>-27</afa><brutto>-127</brutto></tetel></tetelek>
      <osszegek><totalossz><netto>-100</netto><afa>-27</afa><brutto>-127</brutto></totalossz></osszegek></szamla>`;
    const r = parseSzamlazzResponse(xml);
    if (r.kind !== "ok") throw new Error("nem ok");
    expect(r.extracted.docType).toBe("credit_note");
    expect(r.extracted.refInvoiceNumber).toBe("A-2026-2");
    expect(r.extracted.buyer?.privatePerson).toBe(true);
    expect(r.extracted.paymentMethod).toBe("cash");
    expect(r.extracted.currency).toBe("EUR");
    expect(r.extracted.fulfillmentDate).toBe("2026-01-02");
    expect(r.extracted.lines).toHaveLength(1);
    expect(r.pdf).toBeNull();
  });

  it("hibaválasz: 7 = nincs ilyen számla, más = hiba", () => {
    expect(parseSzamlazzResponse(`<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod><hibauzenet>Nincs</hibauzenet></xmlszamlavalasz>`).kind).toBe("notFound");
    const e = parseSzamlazzResponse(`<xmlszamlavalasz><sikeres>false</sikeres><hibakod>3</hibakod><hibauzenet>Sikertelen bejelentkezés</hibauzenet></xmlszamlavalasz>`);
    expect(e).toEqual({ kind: "error", message: "számlázz.hu hiba (3): Sikertelen bejelentkezés" });
    expect(parseSzamlazzResponse("<valami/>").kind).toBe("error");
  });

  it("sorszám bontása és évváltás", () => {
    expect(splitInvoiceNumber("E-MMCT-2026-41")).toEqual({ prefix: "E-MMCT-2026-", seq: 41 });
    expect(splitInvoiceNumber("SZ0007")).toEqual({ prefix: "SZ", seq: 7 });
    expect(splitInvoiceNumber("ABC")).toBeNull();
    expect(rollYear("E-MMCT-2026-", 2027)).toBe("E-MMCT-2027-");
    expect(rollYear("E-MMCT-2026-", 2026)).toBeNull();
    expect(rollYear("SZ", 2027)).toBeNull();
  });
});

describe("Billingo", () => {
  const doc = {
    id: 55, invoice_number: "MM-2026-12", type: "invoice", payment_method: "wire_transfer", currency: "HUF",
    invoice_date: "2026-11-10", fulfillment_date: "2026-11-09", due_date: "2026-11-18",
    partner: { name: "Teszt Kft.", taxcode: "11111111-2-42", address: { country_code: "HU", post_code: "1111", city: "Budapest", address: "Fő út 2." } },
    items: [{ name: "Javítás", quantity: 2, unit: "óra", net_unit_amount: 10000, net_amount: 20000, gross_amount: 25400, vat: "27%", vat_amount: 5400 },
      { name: "Export", quantity: 1, net_unit_amount: 5000, net_amount: 5000, gross_amount: 5000, vat: "AAM", vat_amount: 0 }],
    summary: { net_amount: 25000, gross_amount: 30400, vat_amount: 5400 },
  };

  it("dokumentum → kiolvasott kimenő számla", () => {
    const x = fromBillingo(doc);
    expect(x).toMatchObject({ docType: "invoice", direction: "out", invoiceNumber: "MM-2026-12", fulfillmentDate: "2026-11-09", paymentMethod: "transfer", currency: "HUF" });
    expect(x.buyer).toMatchObject({ name: "Teszt Kft.", taxNumber: "11111111-2-42", euVat: null, privatePerson: false, address: "1111 Budapest Fő út 2." });
    expect(x.lines![0]).toMatchObject({ quantity: 2, unitNet: 10000, net: 20000, vatRate: 27 });
    expect(vatCodeFor(x.lines![1].vatType, x.lines![1].vatRate)).toBe("AM");
    expect(x.totals).toEqual({ net: 25000, vat: 5400, gross: 30400 });
  });

  it("sztornó hivatkozással, EU-s adószám, magánszemély", () => {
    const x = fromBillingo({ ...doc, type: "cancellation", related_documents: [{ id: 54, invoice_number: "MM-2026-11" }], partner: { name: "X GmbH", taxcode: "DE123456789" } });
    expect(x.docType).toBe("credit_note");
    expect(x.refInvoiceNumber).toBe("MM-2026-11");
    expect(x.buyer?.euVat).toBe("DE123456789");
    expect(x.buyer?.taxNumber).toBeNull();
    expect(fromBillingo({ ...doc, partner: { name: "Kiss Anna" } }).buyer?.privatePerson).toBe(true);
  });

  it("díjbekérő és piszkozat kimarad", () => {
    expect(billingoWanted(doc)).toBe(true);
    expect(billingoWanted({ ...doc, type: "proforma" })).toBe(false);
    expect(billingoWanted({ ...doc, type: "draft" })).toBe(false);
    expect(billingoWanted({ ...doc, invoice_number: null })).toBe(false);
  });
});

describe("közös leképezés", () => {
  it("ÁFA-kulcs és fizetési mód", () => {
    expect(vatOf("27%")).toEqual({ vatRate: 27, vatType: null });
    expect(vatOf("5")).toEqual({ vatRate: 5, vatType: null });
    expect(vatOf("TAM")).toEqual({ vatRate: 0, vatType: "TAM" });
    expect(vatOf("EUFAD37")).toEqual({ vatRate: 0, vatType: "FAD" });
    expect(vatCodeFor(vatOf("F.AFA").vatType, 0)).toBe("FAD27");
    expect(paymentOf("bankcard")).toBe("card");
    expect(paymentOf("Bankkártya")).toBe("card");
    expect(paymentOf("cash")).toBe("cash");
    expect(paymentOf("wire_transfer")).toBe("transfer");
    expect(paymentOf(null)).toBeNull();
  });
});
