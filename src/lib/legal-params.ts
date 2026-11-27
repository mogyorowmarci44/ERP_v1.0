import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { history, payrollParamsAt, resolveAt } from "@/lib/legal-params-calc";
import type { PayrollParams } from "@/lib/payroll-calc";

/** v6.4.0 – Az üzemeltető által rögzített paraméterértékek (kis tábla, kérésenként egyszer olvasva). */
export async function operatorParams() {
  return db.select().from(schema.legalParams).orderBy(asc(schema.legalParams.key), asc(schema.legalParams.validFrom));
}

/** Egy paraméter értéke egy napon. */
export async function paramAt(key: string, date: string): Promise<number | null> {
  return resolveAt(history(key, await operatorParams()), date)?.value ?? null;
}

/** Bérparaméterek egy napra; a társas vállalkozó helyett viselt járulék költségszámlája cégbeállítás. */
export async function payrollParamsFor(date: string, company?: { settings?: unknown } | null): Promise<PayrollParams> {
  const acc = (company?.settings as { payrollMemberTbAccount?: string | null } | null | undefined)?.payrollMemberTbAccount || "551";
  return payrollParamsAt(date, await operatorParams(), acc);
}
