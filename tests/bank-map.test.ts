import { describe, expect, it } from "vitest";
import { batchToExtracted, dailyBatches, toStatementTx, txKey, type EbTransaction } from "@/lib/bank/map";

const tx = (o: Partial<EbTransaction>): EbTransaction => ({ transaction_amount: { currency: "HUF", amount: "1000" }, status: "BOOK", booking_date: "2026-11-20", ...o });

describe("toStatementTx", () => {
  it("terhelés negatív, a kedvezményezett az ellenoldal", () => {
    const r = toStatementTx(tx({ credit_debit_indicator: "DBIT", transaction_amount: { amount: "9950.00", currency: "HUF" }, creditor: { name: "MÓR-TANK KFT" }, creditor_account: { iban: "HU42 1177 3016 1111 1018 0000 0000" }, remittance_information: ["Kártyás vásárlás", "A28800059/0825/00026"] }))!;
    expect(r.amount).toBe(-9950);
    expect(r.counterparty).toBe("MÓR-TANK KFT");
    expect(r.counterpartyAccount).toBe("HU42117730161111101800000000");
    expect(r.description).toBe("Kártyás vásárlás A28800059/0825/00026");
  });
  it("jóváírás pozitív, a fizető az ellenoldal; előjeles összegnél is az irány számít", () => {
    const r = toStatementTx(tx({ credit_debit_indicator: "CRDT", transaction_amount: { amount: "-1085000", currency: "HUF" }, debtor: { name: "Ignác Laura" } }))!;
    expect(r.amount).toBe(1085000);
    expect(r.counterparty).toBe("Ignác Laura");
  });
  it("irány nélkül az előjel dönt; dátum nélkül nincs sor", () => {
    expect(toStatementTx(tx({ transaction_amount: { amount: "-60", currency: "HUF" } }))!.amount).toBe(-60);
    expect(toStatementTx(tx({ booking_date: null, value_date: null, transaction_date: null }))).toBeNull();
    expect(toStatementTx(tx({ transaction_amount: { amount: "0" } }))).toBeNull();
  });
  it("devizás eredeti összeg", () => {
    const r = toStatementTx(tx({ credit_debit_indicator: "DBIT", exchange_rate: { instructed_amount: { amount: "2300", currency: "EUR" } } }))!;
    expect(r.fxAmount).toBe(-2300);
    expect(r.fxCurrency).toBe("EUR");
  });
});

describe("dailyBatches", () => {
  const list = [
    tx({ entry_reference: "A", booking_date: "2026-11-19", credit_debit_indicator: "DBIT" }),
    tx({ entry_reference: "B", booking_date: "2026-11-20", credit_debit_indicator: "CRDT" }),
    tx({ entry_reference: "C", booking_date: "2026-11-20", credit_debit_indicator: "DBIT" }),
    tx({ entry_reference: "D", booking_date: "2026-11-21", status: "PDNG" }),
    tx({ entry_reference: "E", booking_date: "2026-11-24" }),
    tx({ entry_reference: "B", booking_date: "2026-11-20", credit_debit_indicator: "CRDT" }), // a bank kétszer adta
  ];
  it("napokra bont, kihagyja a függőt, az ismertet, a tartományon kívülit és a duplikátumot", () => {
    const b = dailyBatches(list, { since: "2026-11-19", until: "2026-11-23", known: new Set(["ref:A"]) });
    expect(b.map((x) => x.date)).toEqual(["2026-11-20"]);
    expect(b[0].keys).toEqual(["ref:B", "ref:C"]);
    expect(b[0].transactions.map((t) => t.amount)).toEqual([1000, -1000]);
  });
  it("azonosító nélkül tartalom-alapú kulcs", () => {
    expect(txKey(tx({ remittance_information: ["x"] }))).toMatch(/^h:2026-11-20/);
  });
  it("kivonat-formátum", () => {
    const [b] = dailyBatches(list, { since: "2026-11-20", until: "2026-11-20", known: new Set() });
    const x = batchToExtracted(b, { iban: "HU00", currency: "HUF" });
    expect(x.docType).toBe("bank_statement");
    expect(x.statement?.transactions).toHaveLength(2);
    expect(x.statement?.periodFrom).toBe("2026-11-20");
  });
});
