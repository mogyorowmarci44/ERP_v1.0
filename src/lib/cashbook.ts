/**
 * v2.0 – Bevételi-kiadási (pénzforgalmi) nyilvántartás adószámos magánszemélynek.
 * A pénzeszköz-számlák (38x) mozgásai, az ellenszámlák alapján kategorizálva.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, partners } from "@/db/schema";
import { round2 } from "./money";

import { categorize, type CashCategory } from "./cash-category";
export { CASH_CATEGORY_LABEL, categorize, type CashCategory } from "./cash-category";

export type CashRow = {
  entryId: number;
  date: string;
  number: string;
  description: string;
  partner: string | null;
  moneyAccount: string;
  inflow: number;
  outflow: number;
  category: CashCategory;
  counter: string;
};

export async function cashbook(companyId: number, from: string, to: string): Promise<CashRow[]> {
  const moneyLines = await db
    .select({
      entryId: journalEntries.id,
      date: journalEntries.date,
      number: journalEntries.number,
      description: journalEntries.description,
      code: accounts.code,
      accName: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        gte(journalEntries.date, from),
        lte(journalEntries.date, to),
        sql`${accounts.code} like '38%' and ${accounts.code} <> '389'`,
      ),
    )
    .orderBy(asc(journalEntries.date), asc(journalEntries.number));
  if (moneyLines.length === 0) return [];

  const entryIds = [...new Set(moneyLines.map((l) => l.entryId))];
  const others = await db
    .select({ entryId: journalLines.entryId, code: accounts.code, name: accounts.name, partner: partners.name })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(and(eq(journalLines.companyId, companyId), inArray(journalLines.entryId, entryIds)));

  return moneyLines.map((l) => {
    const counter = others.filter((o) => o.entryId === l.entryId && !(o.code.startsWith("38") && o.code !== "389"));
    const codes = counter.map((o) => o.code);
    const net = round2(Number(l.debit) - Number(l.credit));
    return {
      entryId: l.entryId,
      date: l.date,
      number: l.number,
      description: l.description,
      partner: counter.find((o) => o.partner)?.partner ?? null,
      moneyAccount: `${l.code} ${l.accName}`,
      inflow: net > 0 ? net : 0,
      outflow: net < 0 ? -net : 0,
      category: categorize(codes),
      counter: [...new Set(counter.map((o) => `${o.code} ${o.name}`))].join(", "),
    };
  });
}
