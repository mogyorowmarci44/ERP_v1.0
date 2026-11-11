import { describe, expect, it } from "vitest";
import { assignContractNos, buildLoanBook, fxRepaymentSplit, nextContractNo, revaluationDiff, type LoanSourceRow } from "@/lib/member-loan-book";

const base = { number: "X", description: "", sourceType: "member_loan", partnerId: 1, partnerName: "Tag Béla" };
const loan = (entryId: number, date: string, amount: number, due: string, extra: Partial<LoanSourceRow> = {}): LoanSourceRow => ({
  ...base, entryId, date, signed: amount,
  terms: { dueDate: due, originalDueDate: null, contractNo: null, currency: null, amountFx: null, note: null }, ...extra,
});
const repay = (entryId: number, date: string, amount: number, extra: Partial<LoanSourceRow> = {}): LoanSourceRow => ({ ...base, entryId, date, signed: -amount, ...extra });

describe("tagi kölcsön könyv", () => {
  it("forintos FIFO, státuszok, lejárati ütemezés", () => {
    const b = buildLoanBook([
      loan(1, "2026-01-10", 200000, "2026-03-01"),
      loan(2, "2026-02-10", 300000, "2026-12-01"),
      repay(3, "2026-03-05", 250000),
    ], "2026-11-11");
    const [m] = b.members;
    expect(m.balance).toBe(250000);
    expect(m.rows[0]).toMatchObject({ open: 0, status: "Rendezve" });
    expect(m.rows[1]).toMatchObject({ open: 250000, status: "Hamarosan lejár" });
    expect(b.ladder).toEqual([{ month: "2026-12", amount: 250000 }]);
    expect(m.nextDue).toBe("2026-12-01");
    expect(b.series.map((s) => s.total)).toEqual([200000, 500000, 250000]);
  });

  it("eredeti és új lejárat a hosszabbításokból", () => {
    const b = buildLoanBook([
      loan(1, "2025-10-04", 450000, "2026-05-24", {
        extensions: [{ seq: 1, extendedOn: "2026-03-25", days: 60, fromDue: "2026-03-25", toDue: "2026-05-24", docNo: "TK-2025-006/M1", note: null }],
      }),
    ], "2026-11-11");
    const r = b.members[0].rows[0];
    expect(r.originalDueDate).toBe("2026-03-25");
    expect(r.dueDate).toBe("2026-05-24");
    expect(r.status).toBe("Lejárt");
    expect(b.overdue).toBe(450000);
  });

  it("devizás kölcsön: a pénztár devizasorából, devizás FIFO, átértékelés, realizált különbözet", () => {
    const rows: LoanSourceRow[] = [
      loan(1, "2026-08-15", 3670000, "2027-08-15", { moneyFx: { currency: "EUR", amountFx: 10000 } }),
      repay(2, "2026-10-01", 1101000, { fx: { kind: "repayment", currency: "EUR", amountFx: 3000, rate: 367 } }),
    ];
    let b = buildLoanBook(rows, "2026-12-31");
    let m = b.members[0];
    expect(m.fx).toEqual([{ currency: "EUR", balanceFx: 7000, bookHuf: 2569000, avgRate: 367 }]);
    expect(m.rows[0]).toMatchObject({ currency: "EUR", openFx: 7000, open: 2569000 });
    // fordulónap: MNB 385 → +126 000 Ft kötelezettség-növekedés
    const diff = revaluationDiff(m.fx[0], 385);
    expect(diff).toBe(126000);
    rows.push({ ...base, entryId: 3, date: "2026-12-31", sourceType: "member_loan_reval", signed: diff, fx: { kind: "reval", currency: "EUR", amountFx: 0, rate: 385 } });
    b = buildLoanBook(rows, "2026-12-31");
    m = b.members[0];
    expect(m.fx[0]).toMatchObject({ balanceFx: 7000, bookHuf: 2695000, avgRate: 385 });
    expect(m.balance).toBe(2695000);
    expect(m.revaluation).toBe(126000);
    // visszafizetés 1000 EUR a pénztárból (pénztár átlagár 380): a kötelezettség 385-ön csökken → 5 000 Ft nyereség
    expect(fxRepaymentSplit(1000, m.fx[0], 380)).toEqual({ loanHuf: 385000, moneyHuf: 380000, diff: 5000 });
  });

  it("visszafizetés kifejezett párosítással (TKV → TK), a maradék FIFO", () => {
    const b = buildLoanBook([
      loan(1, "2025-06-14", 200000, "2025-09-12", { terms: { dueDate: "2025-09-12", originalDueDate: null, contractNo: "TK-2025-002", currency: null, amountFx: null, note: null } }),
      loan(2, "2025-07-14", 700000, "2025-10-12", { terms: { dueDate: "2025-10-12", originalDueDate: null, contractNo: "TK-2025-003", currency: null, amountFx: null, note: null } }),
      repay(3, "2025-10-03", 350000, { repayment: { docNo: "TKV-2025-003", allocations: [{ loanEntryId: 2, amount: 350000 }], note: null } }),
      repay(4, "2025-11-01", 250000, { repayment: { docNo: "TKV-2025-004", allocations: null, note: null } }),
    ], "2026-01-01");
    const rows = b.members[0].rows;
    expect(rows.find((r) => r.entryId === 3)!.allocations).toEqual([{ loanEntryId: 2, contractNo: "TK-2025-003", loanDate: "2025-07-14", amount: 350000, amountFx: null, openAfter: 350000, openFxAfter: null, explicit: true }]);
    // FIFO: előbb a TK-2025-002 (200 000), majd a TK-2025-003-ból 50 000
    expect(rows.find((r) => r.entryId === 4)!.allocations.map((a) => [a.contractNo, a.amount, a.openAfter])).toEqual([["TK-2025-002", 200000, 0], ["TK-2025-003", 50000, 300000]]);
    expect(rows.find((r) => r.entryId === 2)!.repaidBy.map((x) => x.docNo)).toEqual(["TKV-2025-003", "TKV-2025-004"]);
    expect(rows.find((r) => r.entryId === 2)!.open).toBe(300000);
  });

  it("szerződésszámok", () => {
    expect(nextContractNo(["TK-2026-001", "TK-2026-007", "TK-2025-010", null], "2026")).toBe("TK-2026-008");
    expect(nextContractNo(["TK-2026-001", "TKV-2026-002"], "2026", "TKV")).toBe("TKV-2026-003");
    const m = assignContractNos([
      { entryId: 5, date: "2026-02-01", contractNo: null },
      { entryId: 4, date: "2026-01-01", contractNo: "TK-2026-001" },
      { entryId: 6, date: "2025-12-01", contractNo: null },
    ]);
    expect([...m.entries()]).toEqual([[6, "TK-2025-001"], [5, "TK-2026-002"]]);
  });
});

import { numberToHungarian } from "@/lib/hu-words";
describe("számok betűvel", () => {
  it("magyar helyesírás szerint", () => {
    expect(numberToHungarian(200000)).toBe("kétszázezer");
    expect(numberToHungarian(2627713)).toBe("kétmillió-hatszázhuszonhétezer-hétszáztizenhárom");
    expect(numberToHungarian(1999)).toBe("ezerkilencszázkilencvenkilenc");
    expect(numberToHungarian(2000)).toBe("kétezer");
    expect(numberToHungarian(2002)).toBe("kétezer-kettő");
    expect(numberToHungarian(10000)).toBe("tízezer");
    expect(numberToHungarian(3670000)).toBe("hárommillió-hatszázhetvenezer");
    expect(numberToHungarian(450000)).toBe("négyszázötvenezer");
    expect(numberToHungarian(22)).toBe("huszonkettő");
  });
});
