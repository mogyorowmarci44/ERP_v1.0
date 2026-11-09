/**
 * Adatimport (mm-erp-import/1 csomag) – régi nyilvántartásból átalakított számlák, kiegyenlítések,
 * vegyes tételek, partnerek és gépkocsik betöltése EGYETLEN tranzakcióban (vagy minden bekerül, vagy semmi).
 * A könyvelés a normál szolgáltatásokon keresztül történik, így minden szabály (egyensúly, ÁFA, ELÁBÉ) érvényes.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { saveInvoiceDraft, postInvoice, payInvoice, manualEntry, invoiceOpenAmount, type InvoiceInput } from "./ledger";
import { round2 } from "./money";
import type { DraftLine } from "./posting";

type Acc = { code: string; name: string; type: string; currency?: string; reportLine?: string };
type BundleLine = { description: string; unitPrice: number; vatCode: string; account: string; vehicle?: string | null };
type BundleDoc =
  | { kind: "invoice"; src: string; direction: "in" | "out"; partner: string; number: string; date: string; paymentMethod: string;
      lines: BundleLine[]; payments: Array<{ date: string; account: string; amount: number | "open"; moneyHuf?: number }>; declaredVat?: number; vehicle?: string | null;
      /** Opcionális: teljesítés / határidő / időszakos / deviza (alapból HUF, teljesítés = kelte). Devizánál MNB árfolyam, hacsak nincs exchangeRate+rateManual. */
      fulfillmentDate?: string; dueDate?: string | null; periodic?: boolean; currency?: string; exchangeRate?: number; rateManual?: boolean; note?: string }
  | { kind: "entry"; src: string; journal: string; date: string; ref: string; description: string;
      lines: Array<{ account: string; debit: number; credit: number; partner?: string | null; vehicle?: string | null }> }
  | { kind: "sale_entry"; src: string; journal: string; date: string; ref: string; partner: string; description: string; gross: number; vat: number; cogs: number; cogsAccount: string }
  | { kind: "sale_payment"; src: string; date: string; ref: string; vehicle?: string | null; saleInvoice?: string | null; account: string; amount: number; partner?: string }
  | { kind: "cogs_ref"; src: string; ref: string; amount: number; vehicle?: string | null };

export type ImportBundle = {
  format: "mm-erp-import/1";
  source?: string;
  accounts?: Acc[];
  vatCodes?: Array<{ code: string; name: string; rate: number; kind: string }>;
  partners: Array<{ key: string; name: string; taxNumber?: string; isPrivatePerson?: boolean; country?: string }>;
  vehicles: Array<{ key: string; make: string; model: string; plate?: string | null; vin?: string | null; vatTreatment?: "margin" | "normal";
    purchaseDate?: string | null; purchasePrice?: number | null; note?: string }>;
  documents: BundleDoc[];
  memberLoanTerms?: Array<{ date: string; amount: number; partner: string; dueDate: string; ref?: string | null; note?: string | null }>;
  log?: string[][];
};

export type ImportReport = {
  counts: Record<string, number>;
  warnings: string[];
  vatDiffs: Array<{ number: string; declared: number; computed: number }>;
  cogsDiffs: Array<{ vehicle: string; source: number; app: number }>;
};

export async function importBundle(companyId: number, bundle: ImportBundle, userId?: number): Promise<ImportReport> {
  if (bundle.format !== "mm-erp-import/1") throw new Error("Ismeretlen import formátum.");
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId));
    if (n > 0) throw new Error("A cégnél már van könyvelési tétel. Importálni csak üres cégbe lehet (hozz létre új céget az importhoz).");

    const report: ImportReport = { counts: {}, warnings: [], vatDiffs: [], cogsDiffs: [] };
    const count = (k: string) => (report.counts[k] = (report.counts[k] ?? 0) + 1);

    // --- Számlák, ÁFA-kódok -------------------------------------------------
    for (const a of bundle.accounts ?? []) {
      await tx
        .insert(schema.accounts)
        .values({ companyId, code: a.code, name: a.name, type: a.type as "asset", currency: a.currency ?? "HUF", reportLine: a.reportLine ?? null, isPosting: a.code.length > 1 })
        .onConflictDoNothing();
    }
    for (const v of bundle.vatCodes ?? []) {
      await tx.insert(schema.vatCodes).values({ companyId, code: v.code, name: v.name, rate: v.rate, kind: v.kind as "normal" }).onConflictDoNothing();
    }
    const accRows = await tx.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const accId = (code: string) => {
      const a = accRows.find((x) => x.code === code);
      if (!a) throw new Error(`Hiányzó főkönyvi számla: ${code}`);
      return a.id;
    };
    const vatRows = await tx.select().from(schema.vatCodes).where(eq(schema.vatCodes.companyId, companyId));
    const vatId = (code: string) => {
      const v = vatRows.find((x) => x.code === code);
      if (!v) throw new Error(`Hiányzó ÁFA-kód: ${code}`);
      return v.id;
    };

    // --- Partnerek, gépkocsik ---------------------------------------------------
    const partnerIds = new Map<string, number>();
    const existing = await tx.select().from(schema.partners).where(eq(schema.partners.companyId, companyId));
    for (const p of bundle.partners) {
      const found = existing.find((e) => e.name === p.name);
      if (found) partnerIds.set(p.key, found.id);
      else {
        const [ins] = await tx
          .insert(schema.partners)
          .values({ companyId, name: p.name, taxNumber: p.taxNumber ?? null, isPrivatePerson: !!p.isPrivatePerson, country: p.country ?? "HU" })
          .returning({ id: schema.partners.id });
        partnerIds.set(p.key, ins.id);
        count("partner");
      }
    }
    const partnerId = (key?: string | null) => (key ? partnerIds.get(key) ?? null : null);
    const vehicleIds = new Map<string, number>();
    for (const v of bundle.vehicles) {
      const [ins] = await tx
        .insert(schema.vehicles)
        .values({ companyId, make: v.make, model: v.model, plate: v.plate ?? null, vin: v.vin ?? null, vatTreatment: v.vatTreatment ?? "margin",
          purchaseDate: v.purchaseDate ?? null, purchasePrice: v.purchasePrice ?? null, note: v.note ?? null })
        .returning({ id: schema.vehicles.id });
      vehicleIds.set(v.key, ins.id);
      count("gépkocsi");
    }
    const vehicleId = (key?: string | null) => (key ? vehicleIds.get(key) ?? null : null);

    // --- Bizonylatok ------------------------------------------------------------
    const usedNumbers = new Set<string>();
    const saleByNumber = new Map<string, number>();
    const saleByVehicle = new Map<string, number>();
    const salesByPartner = new Map<number, number[]>();
    const cogsRefs: Array<{ vehicle: string; amount: number }> = [];
    const loanEntries: Array<{ entryId: number; date: string; amount: number; partnerId: number | null; used?: boolean }> = [];

    for (const d of bundle.documents) {
      try {
        if (d.kind === "invoice") {
          const pid = partnerId(d.partner)!;
          let number = d.number;
          for (let k = 2; usedNumbers.has(`${d.direction}|${pid}|${number}`); k++) number = `${d.number}/${k}`;
          usedNumbers.add(`${d.direction}|${pid}|${number}`);
          // Már eladott gépkocsira érkező utólagos költség nem mehet a készletre
          const lineAccounts: string[] = [];
          for (const l of d.lines) {
            let code = l.account;
            const vid = vehicleId(l.vehicle);
            if (d.direction === "in" && code === "261" && vid) {
              const [v] = await tx.select({ status: schema.vehicles.status }).from(schema.vehicles).where(eq(schema.vehicles.id, vid));
              if (v?.status === "sold") {
                code = "529";
                report.warnings.push(`${d.src} ${d.number}: eladás utáni költség (${l.description}) → 529, nem a készletre`);
              }
            }
            lineAccounts.push(code);
          }
          const input: InvoiceInput = {
            direction: d.direction,
            partnerId: pid,
            invoiceNumber: number,
            issueDate: d.date,
            fulfillmentDate: d.fulfillmentDate ?? d.date,
            dueDate: d.dueDate ?? null,
            paymentMethod: d.paymentMethod,
            currency: d.currency ?? "HUF",
            exchangeRate: d.exchangeRate ?? 1,
            rateManual: !!d.rateManual,
            periodic: !!d.periodic,
            note: d.note ? `${d.note} (${d.src})` : `Migrálva: ${d.src}`,
            lines: d.lines.map((l, i) => ({
              description: l.description || "-",
              quantity: 1,
              unitPrice: l.unitPrice,
              vatCodeId: vatId(l.vatCode),
              accountId: accId(lineAccounts[i]),
              vehicleId: vehicleId(l.vehicle),
            })),
          };
          const id = await saveInvoiceDraft(companyId, input, undefined, tx);
          await postInvoice(companyId, id, userId, tx);
          count(d.direction === "in" ? "szállítói számla" : "vevőszámla");
          if (d.direction === "out") {
            saleByNumber.set(d.number, id);
            salesByPartner.set(pid, [...(salesByPartner.get(pid) ?? []), id]);
            if (d.vehicle) saleByVehicle.set(d.vehicle, id);
            const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id));
            if (d.declaredVat !== undefined && Math.abs(Number(inv.vatHuf) - d.declaredVat) >= 1) {
              report.vatDiffs.push({ number: d.number, declared: d.declaredVat, computed: Number(inv.vatHuf) });
            }
          }
          for (const [pi, p] of d.payments.entries()) {
            const open = await invoiceOpenAmount(tx, id);
            const last = pi === d.payments.length - 1;
            // a forrás tört forintjai miatt az utolsó kifizetés legfeljebb 2 Ft eltéréssel rendezi a számlát
            const amount = p.amount === "open" || (last && Math.abs(open.openFx - p.amount) <= 2) ? open.openFx : Math.min(p.amount, open.openFx);
            if (p.amount !== "open" && p.amount - open.openFx > 0.5) report.warnings.push(`${d.src} ${number}: a kifizetés (${p.amount}) több a nyitott összegnél (${open.openFx}) – a nyitottig rendezve`);
            if (amount > 0.004) {
              await payInvoice(companyId, id, { date: p.date, moneyAccountId: accId(p.account), amountFx: round2(amount), moneyHuf: p.moneyHuf }, userId, tx);
              count("kiegyenlítés");
            }
          }
        } else if (d.kind === "entry") {
          const lines: DraftLine[] = d.lines
            .filter((l) => Math.abs(l.debit) > 0.004 || Math.abs(l.credit) > 0.004)
            .map((l) => ({ accountId: accId(l.account), debit: round2(l.debit), credit: round2(l.credit), partnerId: partnerId(l.partner), vehicleId: vehicleId(l.vehicle) }));
          if (lines.length < 2) continue;
          const loanAcc = accRows.find((a) => a.code === "4791")?.id;
          const isLoan = loanAcc !== undefined && lines.some((l) => l.accountId === loanAcc);
          const e = await manualEntry(companyId, { journalCode: d.journal, date: d.date, description: `${d.description}${d.ref ? ` [${d.ref}]` : ""}`.slice(0, 500), lines, sourceType: isLoan ? "member_loan" : "manual" }, userId, tx);
          const loanCredit = lines.find((l) => l.accountId === loanAcc && l.credit > 0);
          if (loanCredit) loanEntries.push({ entryId: e.id, date: d.date, amount: loanCredit.credit, partnerId: loanCredit.partnerId ?? null });
          count("vegyes tétel");
        } else if (d.kind === "sale_entry") {
          const pid = partnerId(d.partner);
          const lines: DraftLine[] = [
            { accountId: accId("311"), debit: d.gross, credit: 0, partnerId: pid },
            { accountId: accId("911"), debit: 0, credit: round2(d.gross - d.vat), partnerId: pid },
            { accountId: accId("467"), debit: 0, credit: d.vat, partnerId: pid },
          ];
          if (d.cogs > 0) lines.push({ accountId: accId("814"), debit: d.cogs, credit: 0 }, { accountId: accId(d.cogsAccount), debit: 0, credit: d.cogs });
          await manualEntry(companyId, { journalCode: "VE", date: d.date, description: `${d.description} [${d.ref}]`, lines: lines.filter((l) => l.debit || l.credit) }, userId, tx);
          saleByNumber.set(d.ref, -1);
          count("vegyes tétel");
        } else if (d.kind === "sale_payment") {
          // 1) a befizető partner nyitott vevőszámlája (a forrásban a rendszám-hivatkozás néha téves), 2) számlaszám, 3) gépkocsi
          let invId: number | null = null;
          const pid = partnerId(d.partner);
          for (const cand of (pid && salesByPartner.get(pid)) || []) {
            if ((await invoiceOpenAmount(tx, cand)).openFx > 0.004) { invId = cand; break; }
          }
          const byRef = (d.saleInvoice && saleByNumber.get(d.saleInvoice)) || (d.vehicle && saleByVehicle.get(d.vehicle)) || null;
          if (!invId) invId = byRef;
          else if (byRef && byRef !== invId) report.warnings.push(`${d.src} ${d.ref}: a befizetés a vevő (${d.partner}) saját számlájához rendelve, nem a hivatkozott gépkocsiéhoz`);
          let rest = d.amount;
          if (invId && invId > 0) {
            const open = await invoiceOpenAmount(tx, invId);
            const pay = Math.min(rest, open.openFx);
            if (pay > 0.004) {
              await payInvoice(companyId, invId, { date: d.date, moneyAccountId: accId(d.account), amountFx: round2(pay) }, userId, tx);
              count("kiegyenlítés");
            }
            rest = round2(rest - pay);
          }
          if (rest > 0.004) {
            // számla nélküli vagy túlfizetett vevői befizetés: a vevő számlán marad (követel egyenleg)
            if (invId && invId > 0) report.warnings.push(`${d.src} ${d.ref}: a vevői befizetés ${rest} Ft-tal több a számlánál – a vevő számlán marad`);
            await manualEntry(companyId, { journalCode: d.account === "381" ? "PE" : "BA", date: d.date, description: `Vevői befizetés [${d.ref}]`,
              lines: [{ accountId: accId(d.account), debit: rest, credit: 0, partnerId: partnerId(d.partner) }, { accountId: accId("311"), debit: 0, credit: rest, partnerId: partnerId(d.partner) }] }, userId, tx);
            count("vegyes tétel");
          }
        } else if (d.kind === "cogs_ref") {
          if (d.vehicle) cogsRefs.push({ vehicle: d.vehicle, amount: d.amount });
        }
      } catch (e) {
        throw new Error(`Import hiba (${"src" in d ? d.src : ""} ${"number" in d ? d.number : "ref" in d ? d.ref : ""}): ${e instanceof Error ? e.message : e}`);
      }
    }

    // Tagi kölcsön lejáratok: a befizetési tételhez dátum + összeg + tag alapján
    for (const t of bundle.memberLoanTerms ?? []) {
      const pid = partnerId(t.partner);
      const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
      const cands = loanEntries
        .filter((x) => !x.used && Math.abs(x.amount - t.amount) < 1 && (!pid || x.partnerId === pid) && days(x.date, t.date) <= 7)
        .sort((a, b) => days(a.date, t.date) - days(b.date, t.date));
      const e = cands[0];
      if (e && e.date !== t.date) report.warnings.push(`Tagi kölcsön ${t.ref ?? ""} ${t.amount} Ft: a nyilvántartás ${t.date}, a napló ${e.date} dátumot ír – a napló szerinti tételhez rendelve`);
      if (!e) { report.warnings.push(`Tagi kölcsön lejárat nem párosítható: ${t.date} ${t.amount} Ft (${t.ref ?? "bizonylatszám nélkül"})`); continue; }
      e.used = true;
      await tx.insert(schema.memberLoanTerms).values({ entryId: e.entryId, companyId, dueDate: t.dueDate, note: t.note ?? null });
      count("tagi kölcsön lejárat");
    }

    // ELÁBÉ összevetés: a forrás számított ELÁBÉ-ja vs. az app könyv szerinti értéke
    const cogsAcc = accId("814");
    for (const c of cogsRefs) {
      const vid = vehicleId(c.vehicle);
      if (!vid) continue;
      const [r] = await tx
        .select({ s: sql<number>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)::float8` })
        .from(schema.journalLines)
        .where(and(eq(schema.journalLines.accountId, cogsAcc), eq(schema.journalLines.vehicleId, vid)));
      const app = round2(Number(r.s));
      if (Math.abs(app - c.amount) >= 1) report.cogsDiffs.push({ vehicle: c.vehicle, source: c.amount, app });
    }
    return report;
  }, { isolationLevel: "read committed" });
}

/** Import előnézet: mit tartalmaz a csomag (könyvelés nélkül). */
export function summarizeBundle(b: ImportBundle) {
  const kinds: Record<string, number> = {};
  for (const d of b.documents) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  const dates = b.documents.map((d) => ("date" in d ? d.date : "")).filter(Boolean).sort();
  return { partners: b.partners.length, vehicles: b.vehicles.length, kinds, from: dates[0], to: dates[dates.length - 1], log: b.log ?? [] };
}

/** Már importált cégnél: csak a tagi kölcsön lejáratok pótlása a meglévő befizetési tételekhez. */
export async function importLoanTermsOnly(companyId: number, bundle: ImportBundle) {
  const terms = bundle.memberLoanTerms ?? [];
  if (!terms.length) throw new Error("A csomag nem tartalmaz tagi kölcsön lejáratokat.");
  const [acc] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.code, "4791")));
  if (!acc) throw new Error("Hiányzik a 4791 Tagi kölcsön számla.");
  const rows = await db
    .select({ entryId: schema.journalEntries.id, date: schema.journalEntries.date, credit: schema.journalLines.credit, partner: schema.partners.name, term: schema.memberLoanTerms.entryId })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .leftJoin(schema.partners, eq(schema.partners.id, schema.journalLines.partnerId))
    .leftJoin(schema.memberLoanTerms, eq(schema.memberLoanTerms.entryId, schema.journalEntries.id))
    .where(and(eq(schema.journalLines.accountId, acc.id), sql`${schema.journalLines.credit} > 0`));
  const used = new Set<number>();
  let added = 0;
  const warnings: string[] = [];
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  for (const t of terms) {
    const c = rows
      .filter((r) => !used.has(r.entryId) && Math.abs(Number(r.credit) - t.amount) < 1 && (!r.partner || r.partner === t.partner) && days(r.date, t.date) <= 7)
      .sort((a, b) => days(a.date, t.date) - days(b.date, t.date))[0];
    if (!c) { warnings.push(`Nem párosítható: ${t.date} ${t.amount} Ft`); continue; }
    used.add(c.entryId);
    if (c.term) continue; // már van lejárata – nem írjuk felül
    await db.insert(schema.memberLoanTerms).values({ entryId: c.entryId, companyId, dueDate: t.dueDate, note: t.note ?? null }).onConflictDoNothing();
    added++;
  }
  return { added, warnings };
}

/** A cég összes könyvelési adatának törlése (számlák, tételek, partnerek, gépkocsik). A cég, a számlatükör és a beállítások maradnak. */
export async function wipeCompanyData(companyId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.payments).where(eq(schema.payments.companyId, companyId));
    await tx.delete(schema.invoices).where(eq(schema.invoices.companyId, companyId));
    await tx.delete(schema.memberLoanTerms).where(eq(schema.memberLoanTerms.companyId, companyId));
    await tx.delete(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId));
    await tx.delete(schema.vehicles).where(eq(schema.vehicles.companyId, companyId));
    await tx.delete(schema.partners).where(eq(schema.partners.companyId, companyId));
    await tx.delete(schema.periodLocks).where(eq(schema.periodLocks.companyId, companyId));
  });
}
