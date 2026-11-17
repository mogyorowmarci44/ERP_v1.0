/**
 * v2.2 – Éves beszámoló (Szt. egyszerűsített éves beszámoló / „A” mérleg, összköltség „A” eredménykimutatás).
 *
 *  - A mérleg és az eredménykimutatás a főkönyvből számol (statements.ts – ugyanazok a sorok, mint a Kimutatásoknál).
 *  - A kiegészítő melléklet szövege és a fejléc-/aláírásadatok az `annual_reports` táblában vannak (évenként egy).
 *  - Ha a meta.filed ki van töltve (eredetileg közzétett számok), a kimutatások három oszlopot mutatnak:
 *    közzétett | helyesbítés | helyesbített – így a jelentős összegű hiba hatása soronként követhető.
 */
import { and, eq } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import type { AnnualReportMeta, AnnualSection } from "@/db/schema";
import { dailyRows } from "./reports";
import { buildBalanceSheet, buildPnl, type Bucket, type StatementRow } from "./statements";
import { round2 } from "./money";

export type { AnnualReportMeta, AnnualSection };
export * from "./annual-text";

export async function getAnnualReport(companyId: number, year: number) {
  const [r] = await db
    .select()
    .from(schema.annualReports)
    .where(and(eq(schema.annualReports.companyId, companyId), eq(schema.annualReports.year, year)));
  return r ?? null;
}

export async function listAnnualYears(companyId: number) {
  const rows = await db.select({ year: schema.annualReports.year }).from(schema.annualReports).where(eq(schema.annualReports.companyId, companyId));
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

export function defaultMeta(year: number): AnnualReportMeta {
  return { kind: "Egyszerűsített éves beszámoló", periodFrom: `${year}-01-01`, periodTo: `${year}-12-31` };
}

export type AnnualCol = { key: string; label: string };
/** cells: null = nincs adat (pl. a közzétett beszámolóban nem szerepelt külön sorként). */
export type AnnualRow = StatementRow & { cells: Array<number | null> };
export type AnnualStatement = { title: string; cols: AnnualCol[]; rows: AnnualRow[]; checkOk: boolean };

/** Mérleg és EK a [periodFrom, periodTo] időszakra; meta.filed esetén közzétett / helyesbítés / helyesbített oszlopokkal. */
export async function annualStatements(companyId: number, meta: AnnualReportMeta, fiscalStartMonth: number) {
  const from = meta.periodFrom;
  const to = meta.periodTo;
  const rows = await dailyRows(companyId, to);
  const col: Bucket = { key: from, label: to.slice(0, 4), start: from, end: to };
  const bs = buildBalanceSheet(rows, [col], fiscalStartMonth, from, { netVat: true });
  const pnl = buildPnl(rows, [col]);
  const filed = meta.filed ?? null;
  const yearLbl = to.slice(0, 4);

  const shape = (title: string, src: StatementRow[], pick: (r: StatementRow) => number, prev: ((r: StatementRow) => number) | null, filedMap: Record<string, number> | undefined, checkOk: boolean): AnnualStatement => {
    if (filedMap) {
      const cols = [
        { key: "filed", label: filed?.label ?? "Eredetileg közzétett" },
        { key: "diff", label: "Helyesbítés" },
        { key: "cur", label: `Helyesbített ${yearLbl}` },
      ];
      return {
        title,
        cols,
        checkOk,
        rows: src.map((r) => {
          const cur = round2(pick(r));
          const fv = filedMap[r.key];
          if (fv === undefined || fv === null) return { ...r, cells: [null, null, cur] };
          const f = round2(fv);
          return { ...r, cells: [f, round2(cur - f), cur] };
        }),
      };
    }
    const cols = prev ? [{ key: "prev", label: "Előző év" }, { key: "cur", label: yearLbl }] : [{ key: "cur", label: yearLbl }];
    return { title, cols, checkOk, rows: src.map((r) => ({ ...r, cells: prev ? [round2(prev(r)), round2(pick(r))] : [round2(pick(r))] })) };
  };

  // Mérleg: values[0] = nyitó (előző év vége), values[1] = tárgyév vége
  const hasPrev = bs.rows.some((r) => Math.abs(r.values[0]) >= 0.5);
  const balance = shape("Mérleg", bs.rows, (r) => r.values[1], hasPrev ? (r) => r.values[0] : null, filed?.bs, bs.checkOk);
  const income = shape("Eredménykimutatás", pnl.rows, (r) => r.values[0], null, filed?.pnl, pnl.checkOk);
  const key = (s: AnnualStatement, k: string) => s.rows.find((r) => r.key === k)?.cells.at(-1) ?? 0;
  return {
    balance,
    income,
    figures: {
      total: key(balance, "ASSETS"),
      equity: key(balance, "D"),
      liabilities: key(balance, "F"),
      revenue: key(income, "I"),
      pbt: key(income, "C"),
      tax: key(income, "X"),
      net: key(income, "D"),
    },
  };
}

/** Mentés (évenként upsert). Tx-ben is hívható (import). */
export async function saveAnnualReport(companyId: number, year: number, meta: AnnualReportMeta, sections: AnnualSection[], userId?: number | null, tx: DbOrTx = db) {
  const values = { meta, sections, updatedBy: userId ?? null, updatedAt: new Date() };
  await tx
    .insert(schema.annualReports)
    .values({ companyId, year, ...values })
    .onConflictDoUpdate({ target: [schema.annualReports.companyId, schema.annualReports.year], set: values });
}
