/** 2608 export az ERP adataiból: sablon = a cég legutóbbi betöltött 2608 bevallása, összegek = Bérszámfejtés. */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { buildAnykXml, isPayrollForm } from "./anyk";
import { build2608Sheets, type Person2608 } from "./payroll-2608";
import { loadMonth, periodEnd } from "./payroll";
import { filingsOverview } from "./filings";

/** A sablon: a legkésőbbi időszakú (azon belül a beküldött, majd a legutóbb mentett) betöltött 2608. */
export async function template2608(companyId: number) {
  const all = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId)).orderBy(desc(s.taxFilings.periodFrom)))
    // az ERP által előállított (és „Beküldve” gombbal eltárolt) XML nem minta: abban a dinamikus lapok már sorszámozva vannak
    .filter((f) => isPayrollForm(f.form) && f.sheets.some((x) => /08M$/.test(x.id)) && !/_ERP\.xml$/i.test(f.fileName ?? ""));
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

/** A még be nem küldött, lejárt vagy esedékes hónapok 2608 XML-jei egy ZIP-be (időrendben) + összesítő. */
export async function payrollExportRows(companyId: number) {
  const o = await filingsOverview(companyId);
  return [...o.payroll].reverse().map((r) => {
    const pm = o.payrollMonths[r.period];
    const toNav = pm ? pm.totals.szja + pm.totals.tb + pm.totals.tbCompany + pm.totals.szocho : 0;
    return { ...r, pm, toNav, todo: toNav > 0 && (r.status === "missing" || r.status === "due") };
  });
}

export async function payrollZipFiles(companyId: number) {
  const rows = (await payrollExportRows(companyId)).filter((r) => r.todo);
  const files: Record<string, string> = {};
  const csv = ["időszak;határidő;személyek;TB-járulék (Ft);szocho (Ft);SZJA (Ft);befizetendő (Ft);figyelmeztetés"];
  for (const r of rows) {
    const x = await payroll2608Xml(companyId, r.period);
    files[`2608_${r.period}_eredeti.xml`] = x.xml;
    csv.push([r.period, r.due, r.pm?.people.map((p) => p.name).join(", ") ?? "", x.totals.tb, x.totals.szocho, r.pm?.totals.szja ?? 0, r.toNav, x.warnings.join(" ")].join(";"));
  }
  return { files, csv: csv.join("\n"), count: rows.length };
}
