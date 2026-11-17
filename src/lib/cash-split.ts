/** Pénzeszközök négy bontásban az Áttekintéshez: készpénz / bankszámla × HUF / EUR (könyv szerinti Ft + devizaösszeg). */
import { and, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { round2 } from "./money";

const { accounts, journalLines, journalEntries } = schema;

export type CashBucket = { key: "cashHuf" | "cashEur" | "bankHuf" | "bankEur"; label: string; huf: number; fx: number | null; currency: string | null; accounts: string[] };

/** Pénztár: 381x (pénztár) és 382x (valutapénztár); bank: a többi 38x, kivéve a 389 átvezetési számlát. */
export const isCashAccount = (code: string) => code.startsWith("381") || code.startsWith("382");
export const isTransferAccount = (code: string) => code.startsWith("389");

export async function cashSplit(companyId: number, asOf: string): Promise<CashBucket[]> {
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      currency: accounts.currency,
      huf: sql<number>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::float8`,
      fx: sql<number>`coalesce(sum(case when ${journalLines.debit} <> 0 then ${journalLines.amountFx} else -${journalLines.amountFx} end), 0)::float8`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(accounts.companyId, companyId), like(accounts.code, "38%"), sql`(${journalEntries.date} is null or ${journalEntries.date} <= ${asOf})`))
    .groupBy(accounts.code, accounts.name, accounts.currency);
  // Deviza: a számla devizája nem HUF, vagy a neve szerint valuta / deviza (pl. a forintértéken migrált EUR számlák).
  const isFx = (r: (typeof rows)[number]) => r.currency !== "HUF" || /EUR|valuta|deviza/i.test(r.name);

  const mk = (key: CashBucket["key"], label: string, cash: boolean, huf: boolean): CashBucket => {
    const mine = rows.filter((r) => !isTransferAccount(r.code) && isCashAccount(r.code) === cash && !isFx(r) === huf);
    return {
      key, label,
      huf: round2(mine.reduce((s, r) => s + Number(r.huf), 0)),
      fx: huf ? null : round2(mine.reduce((s, r) => s + Number(r.fx), 0)),
      currency: huf ? "HUF" : "EUR",
      accounts: mine.map((r) => r.code),
    };
  };
  return [mk("cashHuf", "Készpénz HUF", true, true), mk("cashEur", "Készpénz EUR", true, false), mk("bankHuf", "Bankszámla HUF", false, true), mk("bankEur", "Bankszámla EUR", false, false)];
}
