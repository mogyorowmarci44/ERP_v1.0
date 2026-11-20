/**
 * v3.7.0 – ÁFA-bevallás az ERP-ből: időszakonként a könyvelt számlákból számolt bevallás, összevetve a mérvadó (beküldött)
 * változattal, átviteli lánccal és önellenőrzési pótlékkal; ÁNYK-XML előállítás (egyenként vagy ZIP-ben).
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { db, schema } from "@/db";
import { today } from "./dates";
import { buildAnykXml, dueDate, formFor, isVatForm, monthsBetween, periodOf, type FilingKind } from "./anyk";
import {
  buildVatSheets, computeVatReturn, K, rowsFromFields, selfRevisionSurcharge, surchargeBase,
  type Computed, type Rows, type VatLine,
} from "./vat-return";

const s = schema;
const lastDayOf = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export async function loadVatLines(companyId: number, from: string, to: string): Promise<VatLine[]> {
  const rows = await db
    .select({
      direction: s.invoices.direction, kind: s.vatCodes.kind, rate: s.vatCodes.rate,
      net: s.invoiceLines.netHuf, vat: s.invoiceLines.vatHuf, gross: s.invoiceLines.grossHuf, marginPurchase: s.invoiceLines.marginPurchaseHuf,
      invoiceNumber: s.invoices.invoiceNumber, fulfillmentDate: s.invoices.fulfillmentDate, partnerName: s.partners.name, partnerTax: s.partners.taxNumber,
    })
    .from(s.invoiceLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.invoiceLines.invoiceId))
    .innerJoin(s.vatCodes, eq(s.vatCodes.id, s.invoiceLines.vatCodeId))
    .innerJoin(s.partners, eq(s.partners.id, s.invoices.partnerId))
    .where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.status, "posted"), gte(s.invoices.fulfillmentDate, from), lte(s.invoices.fulfillmentDate, to)))
    .orderBy(asc(s.invoices.fulfillmentDate), asc(s.invoices.invoiceNumber));
  return rows.map((r) => ({
    direction: r.direction, kind: r.kind, rate: Number(r.rate), net: Number(r.net), vat: Number(r.vat), gross: Number(r.gross),
    marginPurchase: r.marginPurchase == null ? null : Number(r.marginPurchase), invoiceNumber: r.invoiceNumber ?? "", fulfillmentDate: r.fulfillmentDate,
    partnerName: r.partnerName, partnerTax: r.partnerTax,
  }));
}

type Filing = typeof s.taxFilings.$inferSelect;

export type PlanRow = {
  period: string; form: string; from: string; to: string; due: string;
  /** mérvadó beküldött változat (ha van) – ehhez képest önellenőrzés */
  base: { id: number; kind: FilingKind; savedAt: string | null; confirmed: boolean } | null;
  prev: Rows | null; next: Rows; computed: Computed;
  mode: "self_revision" | "original" | "same";
  repeated: boolean;
  surcharge: { baseK: number; ruleK: number; chainReduced: boolean; amount: number; amountK: number; days: number; increaseK: number; decreaseK: number };
  diffRows: Array<{ row: string; prevB: number | null; prevC: number | null; nextB: number | null; nextC: number | null }>;
};

/** Az összes ÁFA-időszak terve: az első bevallástól / bizonylattól a legutolsó lezárt hónapig, időrendben, láncolva. */
export async function vatPlan(companyId: number, submitDate = today()): Promise<{ rows: PlanRow[]; company: { name: string; taxNumber: string } }> {
  const [company] = await db.select({ name: s.companies.name, taxNumber: s.companies.taxNumber }).from(s.companies).where(eq(s.companies.id, companyId));
  const filings = (await db.select().from(s.taxFilings).where(eq(s.taxFilings.companyId, companyId))).filter((f) => isVatForm(f.form));
  const [firstInv] = await db.select({ d: s.invoices.fulfillmentDate }).from(s.invoices).where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.status, "posted"))).orderBy(asc(s.invoices.fulfillmentDate)).limit(1);
  const firstP = [filings.map((f) => f.periodFrom).sort()[0], firstInv?.d].filter(Boolean).map((d) => periodOf(d!)).sort()[0];
  const t = today();
  const lastEnded = prevMonth(periodOf(t));
  if (!firstP || firstP > lastEnded) return { rows: [], company: { name: company.name, taxNumber: company.taxNumber ?? "" } };

  const out: PlanRow[] = [];
  let carry = 0;
  for (const period of monthsBetween(firstP, lastEnded)) {
    const versions = filings.filter((f) => periodOf(f.periodFrom) === period).sort((a, b) => +(a.savedAt ?? 0) - +(b.savedAt ?? 0));
    const sub = versions.filter((v) => v.submitted);
    const base: Filing | undefined = sub.at(-1) ?? versions.at(-1);
    // időszak: a beadott bevallás szerinti (pl. 2025.05.12–31), egyébként a teljes hónap
    const from = base?.periodFrom ?? `${period}-01`, to = base?.periodTo ?? lastDayOf(period);
    const form = base?.form ?? formFor("vat", period);
    const computed = computeVatReturn(await loadVatLines(companyId, from, to), carry);
    const next = computed.rows;
    const prev = base ? rowsFromFields(base.sheets[0]?.fields ?? {}) : null;
    const repeated = !!base && versions.some((v) => v.kind === "self_revision" && (v.submitted || v.id === base.id));
    const due = dueDate(form, period);
    const diffRows = diffOf(prev, next);
    const same = !!prev && diffRows.length === 0;
    const sb = prev && !same ? surchargeBase(prev, next) : { base: 0, rule: 0, chainReduced: false, increase: 0, decrease: 0 };
    const sur = selfRevisionSurcharge(sb.base * 1000, due, submitDate, repeated);
    out.push({
      period, form, from, to, due,
      base: base ? { id: base.id, kind: base.kind as FilingKind, savedAt: base.savedAt ? base.savedAt.toISOString().slice(0, 16).replace("T", " ") : null, confirmed: sub.length > 0 } : null,
      prev, next, computed, mode: !base ? "original" : same ? "same" : "self_revision", repeated,
      surcharge: { baseK: sb.base, ruleK: sb.rule, chainReduced: sb.chainReduced, amount: sur.amount, amountK: K(sur.amount), days: sur.days, increaseK: sb.increase, decreaseK: sb.decrease },
      diffRows,
    });
    carry = next["86"]?.c ?? 0;
  }
  return { rows: out, company: { name: company.name, taxNumber: company.taxNumber ?? "" } };
}
const prevMonth = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

const CMP_ROWS = ["05", "06", "07", "09", "12", "13", "14", "36", "50", "64", "65", "66", "69", "76", "82", "83", "84", "85", "86"] as const;
function diffOf(prev: Rows | null, next: Rows) {
  const out: PlanRow["diffRows"] = [];
  for (const r of CMP_ROWS) {
    const p = prev?.[r], n = next[r];
    const pb = p?.b ?? null, pc = p?.c ?? null, nb = n?.b ?? null, nc = n?.c ?? null;
    if ((pb ?? 0) !== (nb ?? 0) || (pc ?? 0) !== (nc ?? 0)) out.push({ row: r, prevB: pb, prevC: pc, nextB: nb, nextC: nc });
  }
  return out;
}

/** Egy időszak ÁNYK-XML-je (önellenőrzés vagy eredeti). */
export async function vatXml(companyId: number, period: string, submitDate = today(), place?: string | null) {
  const { rows, company } = await vatPlan(companyId, submitDate);
  const r = rows.find((x) => x.period === period);
  if (!r) throw new Error("Nincs ilyen ÁFA-időszak.");
  return { xml: await buildPeriodXml(companyId, r, company, submitDate, place), row: r, company };
}

/** A mérvadó beadott változat főlapja (fejadatokhoz). */
async function baseFieldsOf(companyId: number, id: number | undefined) {
  if (!id) return null;
  const [f] = await db.select().from(s.taxFilings).where(and(eq(s.taxFilings.companyId, companyId), eq(s.taxFilings.id, id)));
  return f?.sheets[0]?.fields ?? null;
}

export async function buildPeriodXml(companyId: number, r: PlanRow, company: { name: string; taxNumber: string }, submitDate: string, place?: string | null) {
  const baseFields = await baseFieldsOf(companyId, r.base?.id);
  const sheets = buildVatSheets({
    form: r.form, from: r.from, to: r.to, taxNumber: company.taxNumber, taxpayerName: company.name, baseFields, computed: r.computed, signDate: submitDate, signPlace: place,
    selfRevision: r.mode === "self_revision" && r.prev ? {
      prev: r.prev, repeated: r.repeated, baseK: r.surcharge.baseK, surchargeK: r.surcharge.amountK,
      increaseK: r.surcharge.increaseK, decreaseK: r.surcharge.decreaseK, chainReduced: r.surcharge.chainReduced,
    } : null,
  });
  return buildAnykXml({ taxNumber: company.taxNumber, taxpayerName: company.name, from: r.from, to: r.to, sheets });
}

export const xmlName = (company: string, r: Pick<PlanRow, "form" | "period" | "mode">) => {
  const slug = company.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${r.period}_${r.form}_${r.mode === "original" ? "eredeti" : "onellenorzes"}_${slug}.xml`;
};

/** Az összes eltérő időszak XML-je egy ZIP-ben, időrendben + egy összesítő CSV. */
export async function vatZip(companyId: number, submitDate = today(), place?: string | null) {
  const { rows, company } = await vatPlan(companyId, submitDate);
  const files: Record<string, Uint8Array> = {};
  const todo = rows.filter((r) => r.mode !== "same");
  let i = 1;
  for (const r of todo) files[`${String(i++).padStart(2, "0")}_${xmlName(company.name, r)}`] = strToU8(await buildPeriodXml(companyId, r, company, submitDate, place));
  const csv = ["időszak;nyomtatvány;jelleg;beadott befizetendő (e Ft);beadott átvihető;helyes befizetendő;helyes átvihető;pótlékalap (e Ft);pótlék (Ft);ismételt"]
    .concat(todo.map((r) => [r.period, r.form, r.mode === "original" ? "eredeti" : "önellenőrzés", r.prev?.["84"]?.c ?? "", r.prev?.["86"]?.c ?? "", r.next["84"]?.c ?? "", r.next["86"]?.c ?? "", r.surcharge.baseK, r.surcharge.amount, r.repeated ? "igen" : "nem"].join(";")));
  files["00_osszesito.csv"] = strToU8("﻿" + csv.join("\n"));
  return { zip: zipSync(files), count: todo.length, company };
}

