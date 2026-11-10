/**
 * Beérkező bizonylatok – „Beolvasás és könyvelés”:
 *  1. új tételek lekérése a Google-szkriptből (Gmail + Drive), a már ismertek kihagyásával,
 *  2. kiolvasás (Claude API), 3. javaslat (szabályok + korábbi könyvelés), 4. könyvelés, ha minden ellenőrzés rendben.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import type { ExtractedDoc, InboxProposal, InboxSettings } from "@/db/schema";
import { saveInvoiceDraft, postInvoice, payInvoice, manualEntry, accountIdByCode } from "../ledger";
import { openItems } from "../reports";
import { today } from "../dates";
import { listRemote, fetchRemote } from "./connector";
import { extractDocument, extractionAvailable } from "./extract";
import { proposeInvoice, proposeStatement, type ProposeCtx } from "./propose";

const { inboxDocuments, inboxSettings, companies, partners, invoices, invoiceLines, accounts, vatCodes, vehicles, invoiceChecks } = schema;

export const sha256 = (b64: string) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");

export async function getInboxSettings(companyId: number): Promise<{ settings: InboxSettings; lastSyncAt: Date | null }> {
  const [r] = await db.select().from(inboxSettings).where(eq(inboxSettings.companyId, companyId));
  return { settings: { autoPost: true, ...(r?.settings ?? {}) }, lastSyncAt: r?.lastSyncAt ?? null };
}
export async function saveInboxSettings(companyId: number, s: InboxSettings) {
  await db.insert(inboxSettings).values({ companyId, settings: s }).onConflictDoUpdate({ target: inboxSettings.companyId, set: { settings: s, updatedAt: new Date() } });
}

/** Új bizonylat felvétele a gyűjtőbe (feltöltés vagy Google-forrás). Ugyanaz a fájl (sha256) nem kerül be kétszer. */
export async function addDocument(companyId: number, d: {
  source: "gmail" | "drive" | "upload"; sourceRef: string; sourceUrl?: string | null; kind: "invoice" | "statement";
  filename: string; mime: string; data: string; emailFrom?: string | null; emailSubject?: string | null; emailDate?: string | null;
}) {
  const hash = sha256(d.data);
  const [dupe] = await db.select({ id: inboxDocuments.id }).from(inboxDocuments).where(and(eq(inboxDocuments.companyId, companyId), eq(inboxDocuments.sha256, hash)));
  const [row] = await db.insert(inboxDocuments).values({
    companyId, source: d.source, sourceRef: d.sourceRef, sourceUrl: d.sourceUrl ?? null, kind: d.kind, filename: d.filename.slice(0, 255), mime: d.mime || "application/octet-stream",
    sha256: hash, data: d.data, emailFrom: d.emailFrom ?? null, emailSubject: d.emailSubject ?? null, emailDate: d.emailDate ? new Date(d.emailDate) : null,
    status: dupe ? "duplicate" : "new", error: dupe ? `Ugyanez a fájl már bent van (#${dupe.id}).` : null,
  }).onConflictDoNothing().returning({ id: inboxDocuments.id });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Kontextus a javaslathoz
// ---------------------------------------------------------------------------

export async function loadProposeCtx(companyId: number): Promise<ProposeCtx> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const ps = await db.select().from(partners).where(eq(partners.companyId, companyId));
  const hist = await db
    .select({ partnerId: invoices.partnerId, direction: invoices.direction, periodic: invoices.periodic, code: accounts.code, vat: vatCodes.code, desc: invoiceLines.description, veh: invoiceLines.vehicleId })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
    .innerJoin(vatCodes, eq(vatCodes.id, invoiceLines.vatCodeId))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "posted")))
    .orderBy(desc(invoices.fulfillmentDate))
    .limit(3000);
  const vs = await db.select().from(vehicles).where(eq(vehicles.companyId, companyId));
  const inv = await db.select({ dir: invoices.direction, partnerId: invoices.partnerId, number: invoices.invoiceNumber }).from(invoices)
    .where(and(eq(invoices.companyId, companyId), sql`${invoices.status} <> 'cancelled'`));
  const existing = new Set<string>();
  for (const i of inv) { existing.add(`${i.dir}|${i.partnerId}|${i.number}`); existing.add(`${i.dir}|*|${i.number}`); }
  const vc = await db.select({ code: vatCodes.code }).from(vatCodes).where(eq(vatCodes.companyId, companyId));
  const [oin, oout] = await Promise.all([openItems(companyId, "in"), openItems(companyId, "out")]);
  const open = [...oin.map((o) => ({ o, d: "in" as const })), ...oout.map((o) => ({ o, d: "out" as const }))].map(({ o, d }) => ({
    id: o.id, direction: d, partnerName: o.partnerName, number: o.invoiceNumber, currency: o.currency, openFx: o.openFx,
    openHuf: Math.round((Number(o.grossHuf) * o.openFx) / (Number(o.grossFx) || 1)), dueDate: o.dueDate,
  }));
  const mm = await db.execute(sql`
    select a.code, e.date::text as date, abs(l.debit - l.credit)::float8 as amt from journal_lines l
    join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where l.company_id = ${companyId} and a.code like '38%'`) as unknown as Array<{ code: string; date: string; amt: number }>;
  const moneyMoves = new Set(mm.map((r) => `${r.code}|${r.date}|${Math.round(Number(r.amt) * 100) / 100}`));
  return {
    company: { name: company.name, taxNumber: company.taxNumber },
    partners: ps.map((p) => ({ id: p.id, name: p.name, taxNumber: p.taxNumber, isPrivatePerson: p.isPrivatePerson, country: p.country })),
    history: hist.map((h) => ({ partnerId: h.partnerId, direction: h.direction, accountCode: h.code, vatCode: h.vat, description: h.desc, hasVehicle: h.veh !== null, periodic: h.periodic })),
    vehicles: vs.map((v) => ({ id: v.id, make: v.make, model: v.model, plate: v.plate, vin: v.vin, status: v.status })),
    existing, vatCodes: new Set(vc.map((v) => v.code)), open, moneyMoves,
  };
}

export function propose(ctx: ProposeCtx, kind: string, x: ExtractedDoc): InboxProposal {
  if (x.docType === "bank_statement" || kind === "statement") return x.statement ? proposeStatement(ctx, x) : { kind: "none", issues: ["Nem bankkivonat."] };
  return proposeInvoice(ctx, x, today());
}

// ---------------------------------------------------------------------------
// Könyvelés a javaslat alapján
// ---------------------------------------------------------------------------

async function vatIdByCode(tx: Tx, companyId: number, code: string) {
  const [v] = await tx.select({ id: vatCodes.id }).from(vatCodes).where(and(eq(vatCodes.companyId, companyId), eq(vatCodes.code, code)));
  if (!v) throw new Error(`Ismeretlen ÁFA-kód: ${code}`);
  return v.id;
}

/** Számla-javaslat könyvelése: partner / gépkocsi létrehozása szükség szerint, számla mentése, könyvelése, készpénzes kiegyenlítése. */
export async function bookInvoiceProposal(companyId: number, docId: number, p: NonNullable<InboxProposal["invoice"]>, userId: number | undefined, docUrl: string | null) {
  return db.transaction(async (tx) => {
    let partnerId = p.partner.id ?? null;
    if (!partnerId) {
      const [np] = await tx.insert(partners).values({ companyId, name: p.partner.name, taxNumber: p.partner.taxNumber ?? null, isPrivatePerson: p.partner.privatePerson, country: p.partner.country || "HU" }).returning({ id: partners.id });
      partnerId = np.id;
    }
    let newVehicleId: number | null = null;
    if (p.lines.some((l) => l.newVehicle)) {
      const v = p.vehicle;
      const [nv] = await tx.insert(vehicles).values({ companyId, make: v?.make || "Gépkocsi", model: v?.model || "", plate: v?.plate?.toUpperCase() ?? null, vin: v?.vin?.toUpperCase() ?? null, purchaseDate: p.fulfillmentDate, vatTreatment: "margin", note: "Beérkező bizonylatból létrehozva" }).returning({ id: vehicles.id });
      newVehicleId = nv.id;
    }
    const lines = [];
    for (const l of p.lines) {
      lines.push({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatCodeId: await vatIdByCode(tx, companyId, l.vatCode), accountId: await accountIdByCode(tx, companyId, l.accountCode), vehicleId: l.vehicleId ?? (l.newVehicle ? newVehicleId : null) });
    }
    const id = await saveInvoiceDraft(companyId, {
      direction: p.direction, partnerId, invoiceNumber: p.invoiceNumber, issueDate: p.issueDate, fulfillmentDate: p.fulfillmentDate, dueDate: p.dueDate ?? null,
      paymentMethod: p.paymentMethod, currency: p.currency, exchangeRate: 1, periodic: p.periodic, note: `Beérkező bizonylat #${docId}`, lines,
    }, undefined, tx);
    await postInvoice(companyId, id, userId, tx);
    if (p.payNow) {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
      await payInvoice(companyId, id, { date: p.payNow.date, moneyAccountId: await accountIdByCode(tx, companyId, p.payNow.accountCode), amountFx: Number(inv.grossFx) }, userId, tx);
    }
    if (docUrl) await tx.insert(invoiceChecks).values({ invoiceId: id, companyId, docUrl }).onConflictDoUpdate({ target: invoiceChecks.invoiceId, set: { docUrl } });
    await tx.update(inboxDocuments).set({ status: "booked", invoiceId: id, processedAt: new Date(), error: null }).where(eq(inboxDocuments.id, docId));
    return id;
  });
}

/** Kivonat-sorok könyvelése (csak az egyértelműek; a „review” sorok maradnak). Visszaadja a frissített javaslatot. */
export async function bookStatementRows(companyId: number, docId: number, prop: InboxProposal, userId: number | undefined, only?: number[]) {
  const st = prop.statement!;
  const money = st.moneyAccountCode;
  for (const r of st.rows) {
    if (r.done || r.action === "skip" || r.action === "review") continue;
    if (only && !only.includes(r.idx)) continue;
    try {
      await db.transaction(async (tx) => {
        const moneyId = await accountIdByCode(tx, companyId, money);
        if (r.action === "pay_invoice" && r.invoiceId) {
          const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, r.invoiceId), eq(invoices.companyId, companyId)));
          const open = (await openItems(companyId, inv.direction)).find((o) => o.id === inv.id);
          if (!open) throw new Error("A számla már rendezve van.");
          await payInvoice(companyId, inv.id, { date: r.date, moneyAccountId: moneyId, amountFx: open.openFx, moneyHuf: inv.currency === "HUF" ? undefined : Math.abs(r.amount) }, userId, tx);
        } else if (r.action === "entry" && r.accountCode) {
          const acc = await accountIdByCode(tx, companyId, r.accountCode);
          const a = Math.abs(r.amount);
          const lines = r.amount < 0 ? [{ accountId: acc, debit: a, credit: 0 }, { accountId: moneyId, debit: 0, credit: a }] : [{ accountId: moneyId, debit: a, credit: 0 }, { accountId: acc, debit: 0, credit: a }];
          await manualEntry(companyId, { journalCode: "BA", date: r.date, description: r.text.slice(0, 200) || "Banki tétel", lines }, userId, tx);
        } else if (r.action === "transfer" && r.accountCode) {
          const from = await accountIdByCode(tx, companyId, r.accountCode);
          const transit = await accountIdByCode(tx, companyId, "389");
          const a = Math.abs(r.amount);
          await manualEntry(companyId, { journalCode: "PE", date: r.date, description: `${r.text.slice(0, 150)} – pénztárból`, lines: [{ accountId: transit, debit: a, credit: 0 }, { accountId: from, debit: 0, credit: a }] }, userId, tx);
          await manualEntry(companyId, { journalCode: "BA", date: r.date, description: `${r.text.slice(0, 150)} – jóváírás`, lines: [{ accountId: moneyId, debit: a, credit: 0 }, { accountId: transit, debit: 0, credit: a }] }, userId, tx);
        }
      });
      r.done = true;
      r.reason = null;
    } catch (e) {
      r.action = "review";
      r.reason = (e as Error).message;
    }
  }
  const pending = st.rows.filter((r) => !r.done && r.action !== "skip").length;
  prop.issues = pending ? [`${pending} tétel kézi párosítást igényel.`] : [];
  await db.update(inboxDocuments).set({ proposal: prop, status: pending ? "review" : "booked", processedAt: new Date() }).where(eq(inboxDocuments.id, docId));
  return prop;
}

// ---------------------------------------------------------------------------
// Egy bizonylat feldolgozása és a teljes beolvasás
// ---------------------------------------------------------------------------

export type SyncSummary = { fetched: number; processed: number; booked: number; review: number; duplicate: number; ignored: number; errors: string[] };

export async function processDocument(companyId: number, docId: number, userId: number | undefined, opts: { autoPost: boolean; ctx?: ProposeCtx }) {
  const [doc] = await db.select().from(inboxDocuments).where(and(eq(inboxDocuments.id, docId), eq(inboxDocuments.companyId, companyId)));
  if (!doc) throw new Error("A bizonylat nem található.");
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  let x = doc.extracted;
  if (!x) {
    x = await extractDocument({ data: doc.data, mime: doc.mime, filename: doc.filename }, { name: company.name, taxNumber: company.taxNumber }, { kind: doc.kind, subject: doc.emailSubject, from: doc.emailFrom });
    await db.update(inboxDocuments).set({ extracted: x, status: "extracted" }).where(eq(inboxDocuments.id, docId));
  }
  const ctx = opts.ctx ?? (await loadProposeCtx(companyId));
  const prop = propose(ctx, doc.kind, x);
  const url = doc.sourceUrl ?? `/c/${companyId}/inbox/${docId}/file`;
  if (prop.kind === "none") {
    const dup = prop.issues.some((i) => i.startsWith("Már könyvelve"));
    await db.update(inboxDocuments).set({ proposal: prop, status: dup ? "duplicate" : "ignored", processedAt: new Date() }).where(eq(inboxDocuments.id, docId));
    return dup ? "duplicate" : "ignored";
  }
  await db.update(inboxDocuments).set({ proposal: prop, status: "review" }).where(eq(inboxDocuments.id, docId));
  if (prop.kind === "invoice" && opts.autoPost && prop.issues.length === 0) {
    await bookInvoiceProposal(companyId, docId, prop.invoice!, userId, url);
    return "booked";
  }
  if (prop.kind === "statement" && opts.autoPost) {
    const p2 = await bookStatementRows(companyId, docId, prop, userId);
    return p2.issues.length ? "review" : "booked";
  }
  return "review";
}

/** A gomb: új tételek a Google-szkriptből + minden feldolgozatlan bizonylat feldolgozása. */
export async function runSync(companyId: number, userId: number | undefined): Promise<SyncSummary> {
  const sum: SyncSummary = { fetched: 0, processed: 0, booked: 0, review: 0, duplicate: 0, ignored: 0, errors: [] };
  const { settings } = await getInboxSettings(companyId);
  if (settings.scriptUrl && settings.secretEnc) {
    try {
      const known = (await db.select({ r: inboxDocuments.sourceRef }).from(inboxDocuments).where(eq(inboxDocuments.companyId, companyId))).map((r) => r.r);
      const items = await listRemote(settings, known);
      for (const it of items.slice(0, 60)) {
        try {
          const f = await fetchRemote(settings, it.ref);
          const id = await addDocument(companyId, { source: it.source, sourceRef: it.ref, sourceUrl: it.url ?? null, kind: it.kind, filename: f.filename || it.filename, mime: f.mime || it.mime, data: f.data, emailFrom: it.from, emailSubject: it.subject, emailDate: it.date });
          if (id) sum.fetched++;
        } catch (e) { sum.errors.push(`${it.filename}: ${(e as Error).message}`); }
      }
      if (items.length > 60) sum.errors.push(`Még ${items.length - 60} tétel vár – nyomd meg újra a gombot.`);
      await db.update(inboxSettings).set({ lastSyncAt: new Date() }).where(eq(inboxSettings.companyId, companyId));
    } catch (e) { sum.errors.push((e as Error).message); }
  }
  if (!extractionAvailable()) {
    const pending = await db.select({ id: inboxDocuments.id }).from(inboxDocuments).where(and(eq(inboxDocuments.companyId, companyId), eq(inboxDocuments.status, "new")));
    if (pending.length) sum.errors.push(`${pending.length} bizonylat vár kiolvasásra, de nincs beállítva az ANTHROPIC_API_KEY.`);
    return sum;
  }
  const todo = await db.select({ id: inboxDocuments.id, kind: inboxDocuments.kind }).from(inboxDocuments)
    .where(and(eq(inboxDocuments.companyId, companyId), inArray(inboxDocuments.status, ["new", "extracted"])))
    .orderBy(asc(inboxDocuments.emailDate), asc(inboxDocuments.id));
  // előbb a számlák, utána a kivonatok (hogy a kifizetések a már felvett számlákra párosodjanak)
  todo.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "statement" ? 1 : -1));
  for (const d of todo.slice(0, 40)) {
    try {
      const r = await processDocument(companyId, d.id, userId, { autoPost: settings.autoPost !== false });
      sum.processed++;
      sum[r as "booked" | "review" | "duplicate" | "ignored"]++;
    } catch (e) {
      sum.errors.push(`#${d.id}: ${(e as Error).message}`);
      await db.update(inboxDocuments).set({ status: "error", error: (e as Error).message }).where(eq(inboxDocuments.id, d.id));
    }
  }
  if (todo.length > 40) sum.errors.push(`Még ${todo.length - 40} bizonylat vár feldolgozásra – nyomd meg újra a gombot.`);
  return sum;
}

