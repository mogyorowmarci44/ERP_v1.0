/**
 * v3.6.0 – NAV-bevallások nyilvántartása: ÁNYK mentett nyomtatványok (.frm.enyk / XML, akár ZIP-ben) betöltése,
 * időszakonkénti változatok, a beküldött változat jelölése, ÁFA átviteli lánc ellenőrzése, havi határidő-naptár
 * (ÁFA: 2565 / 2665, járulék: 2608).
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { today } from "./dates";
import {
  decodeBytes, dueDate, formFor, isPayrollForm, isVatForm, monthsBetween, parseAnyk, periodOf, sameTaxpayer, summarize,
  vatChainIssues, type ChainIssue, type FilingKind, type VatResult,
} from "./anyk";
import { listPeople, loadMonth } from "./payroll";

const s = schema;
export type Filing = typeof s.taxFilings.$inferSelect;

// --- betöltés ----------------------------------------------------------------------------------------

export type ImportReport = {
  added: Array<{ file: string; form: string; period: string; kind: FilingKind; id: number }>;
  duplicates: string[];
  /** a betöltött vagy már meglévő (azonos tartalmú) változatok azonosítói */
  ids: number[];
  skipped: Array<{ file: string; reason: string }>;
};

/** Fájlok (ZIP-ek kibontva) → ÁNYK nyomtatványok. Csak a cég saját ÁFA- (xx65) és járulék- (xx08) bevallásai kerülnek be. */
export async function importFilings(companyId: number, files: Array<{ name: string; data: Uint8Array }>): Promise<ImportReport> {
  const [company] = await db.select({ taxNumber: s.companies.taxNumber, name: s.companies.name }).from(s.companies).where(eq(s.companies.id, companyId));
  const rep: ImportReport = { added: [], duplicates: [], skipped: [], ids: [] };
  const flat: Array<{ name: string; data: Uint8Array }> = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      let entries: Record<string, Uint8Array>;
      try { entries = unzipSync(f.data); } catch { rep.skipped.push({ file: f.name, reason: "hibás ZIP" }); continue; }
      for (const [n, d] of Object.entries(entries)) if (d.length && !n.endsWith("/")) flat.push({ name: n.split("/").pop()!, data: d });
    } else flat.push(f);
  }
  for (const f of flat) {
    const name = fixName(f.name);
    if (!/\.(enyk|xml)$/i.test(name)) { rep.skipped.push({ file: name, reason: "nem ÁNYK-állomány (.enyk / .xml)" }); continue; }
    let form;
    try { form = parseAnyk(decodeBytes(f.data)); } catch (e) { rep.skipped.push({ file: name, reason: e instanceof Error ? e.message : "olvashatatlan" }); continue; }
    if (!isVatForm(form.form) && !isPayrollForm(form.form)) { rep.skipped.push({ file: name, reason: `${form.form}: nem ÁFA- vagy járulékbevallás` }); continue; }
    if (company.taxNumber && form.taxNumber && !sameTaxpayer(company.taxNumber, form.taxNumber)) {
      rep.skipped.push({ file: name, reason: `más adózó (${form.taxNumber}) – nem ${company.name}` }); continue;
    }
    if (!form.from || !form.to) { rep.skipped.push({ file: name, reason: "hiányzik a bevallási időszak" }); continue; }
    const sum = summarize(form);
    const sha256 = createHash("sha256").update(JSON.stringify([form.form, form.from, form.to, form.savedAt, form.sheets])).digest("hex");
    const ins = await db.insert(s.taxFilings).values({
      companyId, form: form.form, periodFrom: form.from, periodTo: form.to, kind: sum.kind, source: "import", fileName: name.slice(0, 255),
      savedAt: form.savedAt ? new Date(`${form.savedAt}Z`) : null, signedAt: sum.signedAt, krFileName: form.krFileName?.slice(0, 255) ?? null,
      templateVer: form.templateVer?.slice(0, 16) ?? null, sheets: form.sheets, summary: { sheetCounts: sum.sheetCounts, vat: sum.vat }, sha256,
    }).onConflictDoNothing().returning({ id: s.taxFilings.id });
    if (ins.length) { rep.added.push({ file: name, form: form.form, period: periodOf(form.from), kind: sum.kind, id: ins[0].id }); rep.ids.push(ins[0].id); }
    else {
      rep.duplicates.push(name);
      const [ex] = await db.select({ id: s.taxFilings.id }).from(s.taxFilings).where(and(eq(s.taxFilings.companyId, companyId), eq(s.taxFilings.sha256, sha256)));
      if (ex) rep.ids.push(ex.id);
    }
  }
  return rep;
}

/** A Windows-os ZIP a fájlnevekben #U00e1 alakban kódolja az ékezeteket. */
const fixName = (n: string) => n.replace(/#U([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

export async function setSubmitted(companyId: number, id: number, on: boolean, receiptNo?: string | null) {
  await db.update(s.taxFilings).set({ submitted: on, ...(receiptNo !== undefined ? { receiptNo } : {}) })
    .where(and(eq(s.taxFilings.companyId, companyId), eq(s.taxFilings.id, id)));
}
export async function deleteFiling(companyId: number, id: number) {
  await db.delete(s.taxFilings).where(and(eq(s.taxFilings.companyId, companyId), eq(s.taxFilings.id, id)));
}
export async function getFiling(companyId: number, id: number) {
  const [f] = await db.select().from(s.taxFilings).where(and(eq(s.taxFilings.companyId, companyId), eq(s.taxFilings.id, id)));
  return f ?? null;
}

// --- áttekintés ----------------------------------------------------------------------------------------

export type FilingVersion = {
  id: number; form: string; kind: FilingKind; savedAt: string | null; signedAt: string | null; fileName: string | null; krFileName: string | null;
  submitted: boolean; receiptNo: string | null; vat: VatResult | null; sheetCounts: Record<string, number>; source: string;
};
export type PeriodRow = {
  period: string; form: string; due: string;
  versions: FilingVersion[];
  /** a mérvadó változat: a legutolsó beküldöttnek jelölt; ha nincs jelölés, a legutolsó mentés (megerősítetlen) */
  effective: FilingVersion | null; confirmed: boolean;
  status: "ok" | "unconfirmed" | "missing" | "due" | "upcoming";
};

const toVersion = (f: Filing): FilingVersion => ({
  id: f.id, form: f.form, kind: f.kind as FilingKind, savedAt: f.savedAt ? f.savedAt.toISOString().slice(0, 16).replace("T", " ") : null,
  signedAt: f.signedAt, fileName: f.fileName, krFileName: f.krFileName, submitted: f.submitted, receiptNo: f.receiptNo,
  vat: ((f.summary as { vat?: VatResult | null }).vat ?? null), sheetCounts: ((f.summary as { sheetCounts?: Record<string, number> }).sheetCounts ?? {}), source: f.source,
});

function buildRows(type: "vat" | "payroll", months: string[], filings: Filing[], t: string): PeriodRow[] {
  return months.map((period) => {
    const form = formFor(type, period);
    const versions = filings.filter((f) => periodOf(f.periodFrom) === period && (type === "vat" ? isVatForm(f.form) : isPayrollForm(f.form)))
      .map(toVersion).sort((a, b) => (a.savedAt ?? "").localeCompare(b.savedAt ?? ""));
    const sub = versions.filter((v) => v.submitted);
    const effective = sub.at(-1) ?? versions.at(-1) ?? null;
    const due = dueDate(form, period);
    const ended = periodEndPassed(period, t);
    const status: PeriodRow["status"] = effective ? (sub.length ? "ok" : "unconfirmed") : !ended ? "upcoming" : due < t ? "missing" : "due";
    return { period, form, due, versions, effective, confirmed: sub.length > 0, status };
  });
}
const periodEndPassed = (period: string, t: string) => {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return last < t;
};

export type PayrollMonth = { period: string; people: Array<{ name: string; kind: string; gross: number; tb: number; tbCompany: number; szocho: number; szja: number }>; totals: { gross: number; szja: number; tb: number; tbCompany: number; szocho: number }; runStatus: string | null };

export async function filingsOverview(companyId: number) {
  const t = today();
  const filings = await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId)).orderBy(asc(s.taxFilings.periodFrom));

  // ÁFA: az első beolvasott bevallástól (vagy a cég első bizonylatától) a folyó hónapig
  const [firstInv] = await db.select({ d: s.invoices.fulfillmentDate }).from(s.invoices).where(eq(s.invoices.companyId, companyId)).orderBy(asc(s.invoices.fulfillmentDate)).limit(1);
  const vatFirst = [filings.find((f) => isVatForm(f.form))?.periodFrom, firstInv?.d].filter(Boolean).map((d) => periodOf(d!)).sort()[0];
  const vat = vatFirst ? buildRows("vat", monthsBetween(vatFirst, periodOf(t)), filings, t).reverse() : [];
  const chain: ChainIssue[] = vatChainIssues(vat.filter((r) => r.effective).map((r) => ({ period: r.period, vat: r.effective!.vat })));

  // Járulék: azokban a hónapokban, amikor élő jogviszony van
  const people = await listPeople(companyId);
  const emps = people.flatMap((p) => p.employments);
  const firstEmp = emps.map((e) => e.startDate).sort()[0];
  const liveMonths = firstEmp ? monthsBetween(periodOf(firstEmp), periodOf(t)).filter((m) => emps.some((e) => e.startDate <= `${m}-31` && (!e.endDate || e.endDate >= `${m}-01`))) : [];
  const payroll = buildRows("payroll", liveMonths, filings, t).reverse();
  const payrollMonths: Record<string, PayrollMonth> = {};
  for (const m of liveMonths) {
    const mm = await loadMonth(companyId, m);
    payrollMonths[m] = {
      period: m, runStatus: mm.run?.status ?? null,
      people: mm.rows.map((r) => ({ name: r.name, kind: r.employment.kind, gross: r.result.gross, tb: r.result.tb, tbCompany: r.result.tbCompany, szocho: r.result.szocho, szja: r.result.szja })),
      totals: { gross: mm.totals.gross, szja: mm.totals.szja, tb: mm.totals.tb, tbCompany: mm.totals.tbCompany, szocho: mm.totals.szocho },
    };
  }
  return { vat, chain, payroll, payrollMonths, count: filings.length };
}

/** Minden időszakban a legutolsó mentett változat a beküldött (a korábbi jelölések törlésével). */
export async function markLatestSubmitted(companyId: number, type: "vat" | "payroll") {
  const all = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId)))
    .filter((f) => (type === "vat" ? isVatForm(f.form) : isPayrollForm(f.form)));
  const byPeriod = new Map<string, Filing[]>();
  for (const f of all) byPeriod.set(periodOf(f.periodFrom), [...(byPeriod.get(periodOf(f.periodFrom)) ?? []), f]);
  let n = 0;
  for (const list of byPeriod.values()) {
    const latest = [...list].sort((a, b) => +(a.savedAt ?? 0) - +(b.savedAt ?? 0)).at(-1)!;
    for (const f of list) {
      const on = f.id === latest.id;
      if (f.submitted !== on) await db.update(s.taxFilings).set({ submitted: on }).where(eq(s.taxFilings.id, f.id));
    }
    n++;
  }
  return n;
}

const normName = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(kft|zrt|bt|nyrt|kkt|ev|e\.v|korlatolt felelossegu tarsasag|zartkoruen mukodo reszvenytarsasag|beteti tarsasag)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Partner-adószámok átvétele a beolvasott ÁFA-bevallások M-lapjairól (partner törzsszáma + neve), azoknál a partnereknél,
 * akiknek még nincs adószáma. A név normalizálva (ékezet, cégforma, írásjelek nélkül) egyezzen. Csak a törzsszámot
 * (8 jegy) ismerjük – a partnerhez „12345678” alakban kerül, a teljes adószám később pótolható.
 */
export async function fillPartnerTaxFromFilings(companyId: number) {
  const filings = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId))).filter((f) => isVatForm(f.form));
  const found = new Map<string, { tax8: string; name: string }>();
  for (const f of filings) for (const sh of f.sheets) {
    if (!sh.id.endsWith("M")) continue;
    const tax8 = (sh.fields["0_0A0001C005A"] ?? "").replace(/\D/g, "");
    const name = sh.fields["0_0A0001C006A"] || sh.fields["0_0BXXXXB005A"] || "";
    if (tax8.length === 8 && name) found.set(normName(name), { tax8, name });
  }
  const partners = await db.select().from(s.partners).where(eq(s.partners.companyId, companyId));
  const updated: string[] = [];
  for (const p of partners) {
    if (p.taxNumber) continue;
    const hit = found.get(normName(p.name));
    if (!hit) continue;
    await db.update(s.partners).set({ taxNumber: hit.tax8 }).where(eq(s.partners.id, p.id));
    updated.push(`${p.name} → ${hit.tax8}`);
  }
  return { updated, known: found.size };
}
