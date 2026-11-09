/** Tagi kölcsön nyilvántartás: a 4791-es számla partnerenkénti tételeiből, FIFO-elven párosított visszafizetésekkel. */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { manualEntry, accountIdByCode } from "./ledger";
import { round2 } from "./money";
import { today as todayFn, addDaysIso } from "./dates";

export const MEMBER_LOAN_ACCOUNT = "4791";
const { journalLines, journalEntries, partners, memberLoanTerms, accounts } = schema;

export type LoanRow = {
  entryId: number;
  date: string;
  number: string;
  description: string;
  kind: "loan" | "repayment";
  amount: number;
  dueDate: string | null;
  open: number; // befizetésnél a még vissza nem fizetett rész
  status: "Rendezve" | "Nyitott" | "Hamarosan lejár" | "Lejárt" | "";
  balance: number; // futó egyenleg (tartozás a tag felé)
};

export async function memberLoans(companyId: number, asOf = todayFn()) {
  const acc = await accountIdByCode(db, companyId, MEMBER_LOAN_ACCOUNT);
  const rows = await db
    .select({
      entryId: journalEntries.id,
      date: journalEntries.date,
      number: journalEntries.number,
      description: journalEntries.description,
      partnerId: journalLines.partnerId,
      partnerName: partners.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
      dueDate: memberLoanTerms.dueDate,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .leftJoin(memberLoanTerms, eq(memberLoanTerms.entryId, journalEntries.id))
    // a sztornózott tételek és a stornók kimaradnak
    .where(and(eq(journalLines.accountId, acc), isNull(journalEntries.reversedById), isNull(journalEntries.reversalOfId)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.id));

  const soon = addDaysIso(asOf, 30);
  const byMember = new Map<string, { partnerId: number | null; name: string; rows: LoanRow[] }>();
  for (const r of rows) {
    const key = String(r.partnerId ?? "nincs");
    if (!byMember.has(key)) byMember.set(key, { partnerId: r.partnerId, name: r.partnerName ?? "Partner nélkül", rows: [] });
    const credit = Number(r.credit), debit = Number(r.debit);
    const amount = round2(credit - debit);
    byMember.get(key)!.rows.push({
      entryId: r.entryId, date: r.date, number: r.number, description: r.description,
      kind: amount >= 0 ? "loan" : "repayment", amount: Math.abs(amount), dueDate: r.dueDate,
      open: amount >= 0 ? amount : 0, status: "", balance: 0,
    });
  }

  const members = [...byMember.values()].map((m) => {
    // FIFO: a visszafizetések a legkorábbi nyitott befizetést csökkentik
    let bal = 0;
    for (const r of m.rows) {
      if (r.kind === "loan") bal += r.amount;
      else {
        bal -= r.amount;
        let rest = r.amount;
        for (const l of m.rows) {
          if (rest <= 0) break;
          if (l.kind !== "loan" || l.open <= 0 || l.date > r.date) continue;
          const take = Math.min(rest, l.open);
          l.open = round2(l.open - take);
          rest = round2(rest - take);
        }
      }
      r.balance = round2(bal);
    }
    for (const r of m.rows) {
      if (r.kind !== "loan") continue;
      r.status = r.open <= 0.004 ? "Rendezve" : r.dueDate && r.dueDate < asOf ? "Lejárt" : r.dueDate && r.dueDate <= soon ? "Hamarosan lejár" : "Nyitott";
    }
    const received = round2(m.rows.filter((r) => r.kind === "loan").reduce((s, r) => s + r.amount, 0));
    const repaid = round2(m.rows.filter((r) => r.kind === "repayment").reduce((s, r) => s + r.amount, 0));
    const overdue = round2(m.rows.filter((r) => r.status === "Lejárt").reduce((s, r) => s + r.open, 0));
    const dueSoon = round2(m.rows.filter((r) => r.status === "Hamarosan lejár").reduce((s, r) => s + r.open, 0));
    return { ...m, received, repaid, balance: round2(received - repaid), overdue, dueSoon };
  });
  members.sort((a, b) => b.balance - a.balance);
  return {
    members,
    total: round2(members.reduce((s, m) => s + m.balance, 0)),
    overdue: round2(members.reduce((s, m) => s + m.overdue, 0)),
    dueSoon: round2(members.reduce((s, m) => s + m.dueSoon, 0)),
  };
}

/** Új tagi kölcsön befizetés vagy visszafizetés könyvelése (T pénzeszköz / K 4791, ill. fordítva). */
export async function recordMemberLoan(
  companyId: number,
  input: { partnerId: number; kind: "loan" | "repayment"; date: string; amount: number; moneyAccountId: number; amountFx?: number | null; dueDate?: string | null; note?: string | null },
  userId?: number,
) {
  if (!(input.amount > 0)) throw new Error("Az összeg legyen pozitív.");
  if (input.kind === "loan" && !input.dueDate) throw new Error("Befizetéshez add meg a lejáratot.");
  return db.transaction(async (tx: Tx) => {
    const loanAcc = await accountIdByCode(tx, companyId, MEMBER_LOAN_ACCOUNT);
    const [money] = await tx.select().from(accounts).where(and(eq(accounts.id, input.moneyAccountId), eq(accounts.companyId, companyId)));
    if (!money || !money.code.startsWith("38")) throw new Error("Pénzeszköz számlát (38x) kell választani.");
    const [p] = await tx.select().from(partners).where(and(eq(partners.id, input.partnerId), eq(partners.companyId, companyId)));
    if (!p) throw new Error("A tag nem található.");
    const moneyLine = { accountId: money.id, partnerId: p.id, amountFx: input.amountFx ?? null };
    const loanLine = { accountId: loanAcc, partnerId: p.id };
    const lines =
      input.kind === "loan"
        ? [{ ...moneyLine, debit: input.amount, credit: 0 }, { ...loanLine, debit: 0, credit: input.amount }]
        : [{ ...loanLine, debit: input.amount, credit: 0 }, { ...moneyLine, debit: 0, credit: input.amount }];
    const entry = await manualEntry(
      companyId,
      {
        journalCode: money.code.startsWith("381") ? "PE" : "BA",
        date: input.date,
        description: `${input.kind === "loan" ? "Tagi kölcsön befizetés" : "Tagi kölcsön visszafizetés"} – ${p.name}${input.note ? ` (${input.note})` : ""}`,
        lines,
        sourceType: "member_loan",
      },
      userId,
      tx,
    );
    if (input.kind === "loan") await tx.insert(memberLoanTerms).values({ entryId: entry.id, companyId, dueDate: input.dueDate!, note: input.note ?? null });
    return entry;
  });
}

/** Lejárat módosítása (hosszabbítás). */
export async function setLoanDueDate(companyId: number, entryId: number, dueDate: string, note?: string | null) {
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
  if (!e) throw new Error("A tétel nem található.");
  await db
    .insert(memberLoanTerms)
    .values({ entryId, companyId, dueDate, note: note ?? null })
    .onConflictDoUpdate({ target: memberLoanTerms.entryId, set: { dueDate, note: note ?? null, updatedAt: new Date() } });
}

