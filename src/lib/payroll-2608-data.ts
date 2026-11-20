/** 2608 export az ERP adataiból: sablon = a cég legutóbbi betöltött 2608 bevallása, összegek = Bérszámfejtés. */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { buildAnykXml, isPayrollForm } from "./anyk";
import { build2608Sheets, type Person2608 } from "./payroll-2608";
import { loadMonth, periodEnd } from "./payroll";

/** A sablon: a legkésőbbi időszakú (azon belül a beküldött, majd a legutóbb mentett) betöltött 2608. */
export async function template2608(companyId: number) {
  const all = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId)).orderBy(desc(s.taxFilings.periodFrom)))
    .filter((f) => isPayrollForm(f.form) && f.sheets.some((x) => /08M$/.test(x.id)));
  return all.sort((a, b) => b.periodFrom.localeCompare(a.periodFrom) || Number(b.submitted) - Number(a.submitted) || +(b.savedAt ?? 0) - +(a.savedAt ?? 0))[0] ?? null;
}

export async function payroll2608Xml(companyId: number, period: string) {
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  const t = await template2608(companyId);
  if (!t) throw new Error("Nincs betöltött 2608 minta: töltsd ki egyszer az ÁNYK-ban, és töltsd be a .frm.enyk-t a NAV-bevallások oldalon.");
  const m = await loadMonth(companyId, period);
  const pct = (n: number) => n / 100;
  const emps = await db.select().from(s.employees).where(and(eq(s.employees.companyId, companyId)));
  const people: Person2608[] = m.rows.map((r) => {
    const tb = r.result.tb + r.result.tbCompany;
    return {
      taxId: emps.find((e) => e.id === r.employeeId)?.taxId ?? "", name: r.name,
      tb, tbBase: Math.round(tb / pct(m.params.tbPct)), szocho: r.result.szocho, szochoBase: Math.round(r.result.szocho / pct(m.params.szochoPct)),
    };
  }).filter((p) => p.tb || p.szocho);
  const from = `${period}-01`, to = periodEnd(period);
  const r = build2608Sheets({ template: t.sheets, templateFrom: t.periodFrom, templateTo: t.periodTo, from, to, people });
  const main = t.sheets.find((x) => /08A$/.test(x.id))?.fields ?? {};
  const xml = buildAnykXml({ taxNumber: company.taxNumber || main["0_0A0001C002A"] || "", taxpayerName: main["0_0A0001C013A"] || company.name, from, to, sheets: r.sheets });
  return { xml, warnings: r.warnings, totals: r.totals, template: t };
}
