/**
 * v2.2 – Kiegészítő import (mm-erp-delta/1): MEGLÉVŐ könyvelés mellé tölt be új tételeket, semmit nem töröl.
 *
 *  - Minden tételnek egyedi `ref` azonosítója van; a már betöltött ref-et kihagyja (kétszer nem könyvel).
 *  - A könyvelés a normál szolgáltatásokon megy át (számsorrend, időszakzár, ÁFA, különbözeti karton, ELÁBÉ).
 *  - Előnézet: ugyanaz a futás, a végén visszagörgetve – így pontosan látszik, mi lesz belőle (bizonylatszámokkal).
 *  - Betöltés: vagy minden tétel bekerül, vagy semmi (ha bármelyik hibás, nem könyvel).
 *
 * Hivatkozások: partner "P<id>" / gépkocsi "V<id>" (az exportból) vagy a csomagban felvett új kulcs;
 * számla id-vel, {direction, number, partner}-rel vagy a csomag egy korábbi számla-tételének ref-jével;
 * naplótétel bizonylatszámmal (pl. "VN-2026/000012").
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { cancelInvoice, invoiceOpenAmount, manualEntry, payInvoice, postInvoice, reverseEntry, saveInvoiceDraft } from "./ledger";
import { createAsset, postDepreciation, registerFromLine } from "./assets";
import { round2 } from "./money";
import type { DraftLine } from "./posting";

const s = schema;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

type PartnerRef = string;
type InvoiceRef = number | string | { direction: "in" | "out"; number: string; partner: PartnerRef };

export type DeltaItem =
  | { kind: "entry"; ref: string; journal: string; date: string; description: string;
      lines: Array<{ account: string; debit?: number | null; credit?: number | null; partner?: PartnerRef | null; vehicle?: string | null; description?: string | null; amountFx?: number | null }> }
  | { kind: "invoice"; ref: string; direction: "in" | "out"; partner: PartnerRef; number: string; issueDate: string; fulfillmentDate?: string; dueDate?: string | null;
      paymentMethod?: string; currency?: string; exchangeRate?: number; rateManual?: boolean; periodic?: boolean; note?: string | null;
      lines: Array<{ description: string; quantity?: number; unitPrice: number; vatCode: string; account: string; vehicle?: string | null }> }
  | { kind: "payment"; ref: string; invoice: InvoiceRef; date: string; account: string; amount: number | "open"; moneyHuf?: number | null }
  | { kind: "reversal"; ref: string; entry: string; date: string; reason?: string }
  | { kind: "asset"; ref: string; invoiceLineId?: number; invoiceRef?: string; lineIndex?: number;
      name?: string; account?: string; activationDate?: string; cost?: number; lifeYears?: number; salvage?: number; taxRatePct?: number | null; openingAccumulated?: number; note?: string }
  | { kind: "depreciation"; ref: string; to: string };

export type DeltaBundle = {
  format: "mm-erp-delta/1";
  company?: { taxNumber?: string | null; name?: string | null };
  basedOn?: string;
  note?: string;
  partners?: Array<{ key: string; name: string; taxNumber?: string | null; country?: string | null; isPrivatePerson?: boolean }>;
  vehicles?: Array<{ key: string; make: string; model: string; plate?: string | null; vin?: string | null; year?: number | null; vatTreatment?: "margin" | "normal"; purchaseDate?: string | null; purchasePrice?: number | null }>;
  items: DeltaItem[];
};

export type DeltaItemResult = { ref: string; kind: string; status: "new" | "skip" | "error"; message: string; entries: string[]; amount?: number };
export type DeltaReport = { dryRun: boolean; applied: boolean; batchId?: number; results: DeltaItemResult[]; created: { partners: string[]; vehicles: string[]; matched: string[] }; counts: Record<string, number> };

export const KIND_HU: Record<string, string> = { entry: "vegyes / bank / pénztár tétel", invoice: "számla", payment: "kiegyenlítés", reversal: "storno", asset: "tárgyi eszköz", depreciation: "ÉCS elszámolás" };

class Rollback extends Error {
  constructor(public report: DeltaReport) { super("rollback"); }
}

export function parseDelta(json: string): DeltaBundle {
  let b: DeltaBundle;
  try { b = JSON.parse(json); } catch { throw new Error("A fájl nem érvényes JSON."); }
  if (b?.format === ("mm-erp-import/1" as string)) throw new Error("Ez teljes import csomag (mm-erp-import/1) – az csak üres cégbe tölthető. Kiegészítéshez mm-erp-delta/1 csomag kell.");
  if (b?.format === ("mm-erp-export/1" as string)) throw new Error("Ez egy adatexport fájl, nem kiegészítő csomag.");
  if (b?.format !== "mm-erp-delta/1") throw new Error("Ez nem kiegészítő csomag (mm-erp-delta/1).");
  if (!Array.isArray(b.items) || !b.items.length) throw new Error("A csomagban nincs tétel.");
  const refs = new Set<string>();
  for (const [i, it] of b.items.entries()) {
    if (!it?.ref || typeof it.ref !== "string") throw new Error(`A(z) ${i + 1}. tételnek nincs ref azonosítója.`);
    if (it.ref.length > 128) throw new Error(`Túl hosszú ref: ${it.ref.slice(0, 40)}…`);
    if (refs.has(it.ref)) throw new Error(`Kétszer szerepel ugyanaz a ref: ${it.ref}`);
    refs.add(it.ref);
    if (!KIND_HU[it.kind]) throw new Error(`Ismeretlen tételtípus (${it.ref}): ${(it as { kind: string }).kind}`);
  }
  return b;
}

/** Előnézet (dryRun) vagy betöltés. Betöltésnél bármely hiba esetén semmi nem kerül be. */
export async function runDelta(companyId: number, bundle: DeltaBundle, opts: { dryRun: boolean; userId?: number; fileName?: string }): Promise<DeltaReport> {
  const report: DeltaReport = { dryRun: opts.dryRun, applied: false, results: [], created: { partners: [], vehicles: [], matched: [] }, counts: {} };
  try {
    await db.transaction(async (tx) => {
      const [company] = await tx.select().from(s.companies).where(eq(s.companies.id, companyId));
      const norm = (x?: string | null) => (x ?? "").replace(/\D/g, "").slice(0, 8);
      if (bundle.company?.taxNumber && company.taxNumber && norm(bundle.company.taxNumber) !== norm(company.taxNumber)) throw new Error(`A csomag másik céghez készült (adószám: ${bundle.company.taxNumber}).`);
      if (!bundle.company?.taxNumber && bundle.company?.name && bundle.company.name.trim() !== company.name.trim()) throw new Error(`A csomag másik céghez készült (${bundle.company.name}).`);

      const [batch] = await tx.insert(s.importBatches).values({ companyId, fileName: opts.fileName ?? null, note: bundle.note ?? null, userId: opts.userId ?? null }).returning();
      report.batchId = batch.id;

      // --- törzsadatok -------------------------------------------------------------------------
      const accRows = await tx.select().from(s.accounts).where(eq(s.accounts.companyId, companyId));
      const accId = (code: string) => {
        const a = accRows.find((x) => x.code === String(code));
        if (!a) throw new Error(`Ismeretlen főkönyvi számla: ${code}`);
        return a.id;
      };
      const vatRows = await tx.select().from(s.vatCodes).where(eq(s.vatCodes.companyId, companyId));
      const vatId = (code: string) => {
        const v = vatRows.find((x) => x.code === code);
        if (!v) throw new Error(`Ismeretlen ÁFA-kód: ${code}`);
        return v.id;
      };
      const partners = await tx.select().from(s.partners).where(eq(s.partners.companyId, companyId));
      const pMap = new Map<string, number>(partners.map((p) => [`P${p.id}`, p.id]));
      for (const p of bundle.partners ?? []) {
        if (pMap.has(p.key)) continue;
        const found = partners.find((x) => (p.taxNumber && x.taxNumber && norm(x.taxNumber) === norm(p.taxNumber)) || x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
        if (found) {
          pMap.set(p.key, found.id);
          if (found.name.trim() !== p.name.trim()) report.created.matched.push(`${p.name} → ${found.name}`);
          continue;
        }
        const [ins] = await tx.insert(s.partners).values({ companyId, name: p.name.trim(), taxNumber: p.taxNumber ?? null, country: p.country ?? "HU", isPrivatePerson: !!p.isPrivatePerson }).returning({ id: s.partners.id });
        pMap.set(p.key, ins.id);
        report.created.partners.push(p.name);
      }
      const partnerId = (key?: string | null) => {
        if (!key) return null;
        const id = pMap.get(key);
        if (!id) throw new Error(`Ismeretlen partner: ${key}`);
        return id;
      };
      const vehicles = await tx.select({ id: s.vehicles.id }).from(s.vehicles).where(eq(s.vehicles.companyId, companyId));
      const vMap = new Map<string, number>(vehicles.map((v) => [`V${v.id}`, v.id]));
      for (const v of bundle.vehicles ?? []) {
        if (vMap.has(v.key)) continue;
        const [ins] = await tx.insert(s.vehicles).values({ companyId, make: v.make, model: v.model, plate: v.plate ?? null, vin: v.vin ?? null, year: v.year ?? null, vatTreatment: v.vatTreatment ?? "margin", purchaseDate: v.purchaseDate ?? null, purchasePrice: v.purchasePrice ?? null }).returning({ id: s.vehicles.id });
        vMap.set(v.key, ins.id);
        report.created.vehicles.push(`${v.make} ${v.model}${v.plate ? ` ${v.plate}` : ""}`);
      }
      const vehicleId = (key?: string | null) => {
        if (!key) return null;
        const id = vMap.get(key);
        if (!id) throw new Error(`Ismeretlen gépkocsi: ${key}`);
        return id;
      };

      const done = new Set((await tx.select({ ref: s.importRefs.ref }).from(s.importRefs).where(eq(s.importRefs.companyId, companyId))).map((r) => r.ref));
      const invByRef = new Map<string, number>();

      const findInvoice = async (t: Tx, r: InvoiceRef) => {
        if (typeof r === "number") return r;
        if (typeof r === "string") {
          const id = invByRef.get(r) ?? (await t.select({ id: s.importRefs.invoiceId }).from(s.importRefs).where(and(eq(s.importRefs.companyId, companyId), eq(s.importRefs.ref, r))))[0]?.id;
          if (!id) throw new Error(`Ismeretlen számla-hivatkozás: ${r}`);
          return id;
        }
        const [inv] = await t.select({ id: s.invoices.id }).from(s.invoices).where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.direction, r.direction), eq(s.invoices.invoiceNumber, r.number), eq(s.invoices.partnerId, partnerId(r.partner)!)));
        if (!inv) throw new Error(`Nem található számla: ${r.number}`);
        return inv.id;
      };
      const entryByNumber = async (t: Tx, n: string) => {
        const [e] = await t.select().from(s.journalEntries).where(and(eq(s.journalEntries.companyId, companyId), eq(s.journalEntries.number, n)));
        if (!e) throw new Error(`Nem található naplótétel: ${n}`);
        return e;
      };

      // --- tételek -----------------------------------------------------------------------------
      for (const it of bundle.items) {
        const res: DeltaItemResult = { ref: it.ref, kind: it.kind, status: "new", message: "", entries: [] };
        report.results.push(res);
        if (done.has(it.ref)) { res.status = "skip"; res.message = "Már betöltve korábban (ugyanez a ref)."; continue; }
        try {
          await tx.transaction(async (t) => {
            const [{ max }] = await t.select({ max: sql<number>`coalesce(max(${s.journalEntries.id}), 0)::int` }).from(s.journalEntries).where(eq(s.journalEntries.companyId, companyId));
            const link: { journalEntryId?: number | null; invoiceId?: number | null; assetId?: number | null } = {};

            if (it.kind === "entry") {
              if (!isDate(it.date)) throw new Error("Hibás dátum.");
              const lines: DraftLine[] = it.lines
                .map((l) => ({ accountId: accId(l.account), debit: round2(Number(l.debit ?? 0)), credit: round2(Number(l.credit ?? 0)), partnerId: partnerId(l.partner), vehicleId: vehicleId(l.vehicle), description: l.description ?? null, amountFx: l.amountFx ?? null }))
                .filter((l) => l.debit > 0.004 || l.credit > 0.004);
              if (lines.length < 2) throw new Error("Legalább két sor kell.");
              const loanAcc = accRows.find((a) => a.code === "4791")?.id;
              const e = await manualEntry(companyId, { journalCode: it.journal, date: it.date, description: it.description.slice(0, 500), lines, sourceType: loanAcc && lines.some((l) => l.accountId === loanAcc) ? "member_loan" : "manual" }, opts.userId, t);
              link.journalEntryId = e.id;
              res.amount = round2(lines.reduce((a, l) => a + l.debit, 0));
              res.message = it.description;
            } else if (it.kind === "invoice") {
              const pid = partnerId(it.partner)!;
              const [dup] = await t.select({ id: s.invoices.id }).from(s.invoices).where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.direction, it.direction), eq(s.invoices.partnerId, pid), eq(s.invoices.invoiceNumber, it.number.trim())));
              if (dup) throw new Error(`Ez a számla már létezik: ${it.number}`);
              if (!isDate(it.issueDate) || (it.fulfillmentDate && !isDate(it.fulfillmentDate))) throw new Error("Hibás dátum.");
              const id = await saveInvoiceDraft(companyId, {
                direction: it.direction, partnerId: pid, invoiceNumber: it.number, issueDate: it.issueDate, fulfillmentDate: it.fulfillmentDate ?? it.issueDate,
                dueDate: it.dueDate ?? null, paymentMethod: it.paymentMethod ?? "transfer", currency: it.currency ?? "HUF", exchangeRate: it.exchangeRate ?? 1,
                rateManual: !!it.rateManual, periodic: !!it.periodic, note: it.note ?? null,
                lines: it.lines.map((l) => ({ description: l.description || "-", quantity: l.quantity ?? 1, unitPrice: l.unitPrice, vatCodeId: vatId(l.vatCode), accountId: accId(l.account), vehicleId: vehicleId(l.vehicle) })),
              }, undefined, t);
              await postInvoice(companyId, id, opts.userId, t);
              const [inv] = await t.select().from(s.invoices).where(eq(s.invoices.id, id));
              invByRef.set(it.ref, id);
              link.invoiceId = id; link.journalEntryId = inv.journalEntryId;
              res.amount = Number(inv.grossHuf);
              const pn = (await t.select({ name: s.partners.name }).from(s.partners).where(eq(s.partners.id, pid)))[0]?.name;
              res.message = `${it.direction === "in" ? "Szállítói" : "Vevő"} számla ${it.number} – ${pn}`;
            } else if (it.kind === "payment") {
              const invId = await findInvoice(t, it.invoice);
              const open = await invoiceOpenAmount(t, invId);
              if (open.openFx <= 0.004) throw new Error("A számla már rendezve van.");
              const amount = it.amount === "open" ? open.openFx : Number(it.amount);
              if (amount - open.openFx > 0.5) throw new Error(`Az összeg (${amount}) több a nyitottnál (${open.openFx}).`);
              await payInvoice(companyId, invId, { date: it.date, moneyAccountId: accId(it.account), amountFx: round2(amount), moneyHuf: it.moneyHuf ?? null }, opts.userId, t);
              const [inv] = await t.select({ number: s.invoices.invoiceNumber }).from(s.invoices).where(eq(s.invoices.id, invId));
              link.invoiceId = invId;
              res.amount = round2(amount);
              res.message = `Kiegyenlítés: ${inv?.number ?? invId}`;
            } else if (it.kind === "reversal") {
              const e = await entryByNumber(t, it.entry);
              const [inv] = await t.select().from(s.invoices).where(and(eq(s.invoices.companyId, companyId), eq(s.invoices.journalEntryId, e.id)));
              const rev = inv ? await cancelInvoice(companyId, inv.id, it.date, opts.userId, t) : await reverseEntry(t, companyId, e.id, it.date, opts.userId, it.reason);
              link.journalEntryId = rev?.id ?? null; link.invoiceId = inv?.id ?? null;
              res.message = inv ? `Számla sztornó: ${inv.invoiceNumber}` : `Storno: ${it.entry}${it.reason ? ` – ${it.reason}` : ""}`;
            } else if (it.kind === "asset") {
              let lineId = it.invoiceLineId;
              if (!lineId && it.invoiceRef) {
                const invId = await findInvoice(t, it.invoiceRef);
                const ls = await t.select({ id: s.invoiceLines.id }).from(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, invId)).orderBy(s.invoiceLines.position);
                lineId = ls[it.lineIndex ?? 0]?.id;
                if (!lineId) throw new Error("A számlán nincs ilyen sor.");
              }
              const a = lineId
                ? await registerFromLine(companyId, lineId, opts.userId, t)
                : await createAsset(companyId, {
                    name: it.name ?? "", accountCode: it.account ?? "", activationDate: it.activationDate ?? "", cost: Number(it.cost ?? 0), salvage: it.salvage,
                    usefulLifeMonths: it.lifeYears ? Math.round(it.lifeYears * 12) : undefined, taxRatePct: it.taxRatePct ?? null, openingAccumulated: it.openingAccumulated, note: it.note ?? null,
                  }, { userId: opts.userId, tx: t });
              if (lineId && (it.lifeYears || it.taxRatePct !== undefined || it.salvage) && a.method === "linear") {
                await t.update(s.fixedAssets).set({ ...(it.lifeYears ? { usefulLifeMonths: Math.round(it.lifeYears * 12) } : {}), ...(it.taxRatePct !== undefined ? { taxRatePct: it.taxRatePct == null ? null : String(it.taxRatePct) } : {}), ...(it.salvage ? { salvage: it.salvage } : {}) }).where(eq(s.fixedAssets.id, a.id));
              }
              link.assetId = a.id;
              res.amount = Number(a.cost);
              res.message = `${a.name} (${a.inventoryNo}) – ${a.method === "lowvalue" ? (a.status === "disposed" ? "már leírva" : "kisértékű, egy összegben leírva") : "havi lineáris ÉCS"}`;
            } else if (it.kind === "depreciation") {
              if (!/^\d{4}-\d{2}$/.test(it.to)) throw new Error("A „to” hónap formátuma ÉÉÉÉ-HH.");
              const r = await postDepreciation(companyId, it.to, opts.userId, t);
              res.amount = round2(r.posted.reduce((a, p) => a + p.total, 0));
              res.message = r.posted.length ? `ÉCS ${r.posted.map((p) => p.period).join(", ")}` : "Nincs elszámolandó ÉCS.";
              if (r.skipped.length) res.message += ` · lezárt hónap miatt kihagyva: ${r.skipped.join(", ")}`;
            }

            const created = await t.select({ id: s.journalEntries.id, number: s.journalEntries.number }).from(s.journalEntries).where(and(eq(s.journalEntries.companyId, companyId), gt(s.journalEntries.id, max))).orderBy(s.journalEntries.id);
            res.entries = created.map((c) => c.number);
            await t.insert(s.importRefs).values({ companyId, batchId: batch.id, ref: it.ref, kind: it.kind, journalEntryId: link.journalEntryId ?? created[0]?.id ?? null, invoiceId: link.invoiceId ?? null, assetId: link.assetId ?? null });
          });
          report.counts[it.kind] = (report.counts[it.kind] ?? 0) + 1;
        } catch (e) {
          res.status = "error";
          res.message = e instanceof Error ? e.message : String(e);
        }
      }

      const ok = report.results.filter((r) => r.status === "new").length;
      await tx.update(s.importBatches).set({ items: ok, summary: report.counts }).where(eq(s.importBatches.id, batch.id));
      if (opts.dryRun || report.results.some((r) => r.status === "error") || ok === 0) throw new Rollback(report);
      report.applied = true;
    });
  } catch (e) {
    if (e instanceof Rollback) return { ...e.report, batchId: undefined };
    throw e;
  }
  return report;
}

/** A korábbi kiegészítő betöltések listája az Adatimport oldalhoz. */
export async function listBatches(companyId: number) {
  return db.select().from(s.importBatches).where(eq(s.importBatches.companyId, companyId)).orderBy(sql`${s.importBatches.id} desc`).limit(20);
}
