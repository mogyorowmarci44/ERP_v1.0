/**
 * v3.10.0 – Napi banki letöltés: az összekapcsolt számlák előző napig könyvelt tételei a Beérkező bizonylatok közé
 * kerülnek (számlánként és naponként egy „kivonat”), és ugyanazon a javaslat- / párosítás- / könyvelési láncon mennek át,
 * mint a feltöltött CSV / Excel kivonat. A már könyvelt pénzmozgásokat a javaslat „már könyvelve” jelöléssel kihagyja.
 */
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BankLink } from "@/db/schema";
import { addDaysIso, today } from "../dates";
import { getInboxSettings, saveInboxSettings, processDocument, loadProposeCtx } from "../inbox/service";
import { listTransactions, ebConfigured } from "./enable-banking";
import { batchToExtracted, dailyBatches, type EbTransaction } from "./map";

const { inboxDocuments, inboxSettings } = schema;

/** Hány napra visszamenőleg nézzük újra (a későn könyvelt tételek miatt). */
const LOOKBACK_DAYS = 10;

export type BankSyncResult = { companyId: number; days: number; transactions: number; booked: number; review: number; errors: string[]; warning?: string };

const refPrefix = (uid: string) => `bank:${uid.slice(0, 80)}:`;

/** A korábban már betöltött tranzakció-kulcsok (a bizonylat JSON-jából). */
async function knownKeys(companyId: number, uid: string, from: string): Promise<{ keys: Set<string>; refs: Set<string> }> {
  const rows = await db.select({ ref: inboxDocuments.sourceRef, data: inboxDocuments.data }).from(inboxDocuments)
    .where(and(eq(inboxDocuments.companyId, companyId), like(inboxDocuments.sourceRef, `${refPrefix(uid)}%`)));
  const keys = new Set<string>(), refs = new Set<string>();
  for (const r of rows) {
    refs.add(r.ref);
    const date = r.ref.slice(refPrefix(uid).length, refPrefix(uid).length + 10);
    if (date < addDaysIso(from, -1)) continue;
    try {
      const j = JSON.parse(Buffer.from(r.data, "base64").toString("utf8")) as { keys?: string[] };
      for (const k of j.keys ?? []) keys.add(k);
    } catch { /* régi / sérült – kihagyjuk */ }
  }
  return { keys, refs };
}

export function consentWarning(link: BankLink, now = today()): string | null {
  if (!link.validUntil) return null;
  const end = link.validUntil.slice(0, 10);
  if (end < now) return "A banki hozzájárulás lejárt – kapcsold össze újra (Beérkező bizonylatok → Beállítások → Bank).";
  const left = Math.round((Date.parse(end) - Date.parse(now)) / 86400_000);
  return left <= 14 ? `A banki hozzájárulás ${left} nap múlva lejár (${end}) – érdemes időben megújítani.` : null;
}

/** Egy cég összes összekapcsolt számlájának letöltése és feldolgozása. */
export async function runBankSync(companyId: number, userId?: number): Promise<BankSyncResult> {
  const res: BankSyncResult = { companyId, days: 0, transactions: 0, booked: 0, review: 0, errors: [] };
  const { settings } = await getInboxSettings(companyId);
  const link = settings.bank;
  if (!link) throw new Error("Ehhez a céghez nincs banki kapcsolat.");
  if (!ebConfigured()) throw new Error("A banki kapcsolat nincs beállítva a szerveren (EB_APP_ID / EB_PRIVATE_KEY).");
  const now = today();
  const until = addDaysIso(now, -1); // csak a lezárt napok – a mai tételek holnap jönnek
  const from = [link.since, addDaysIso(now, -LOOKBACK_DAYS)].sort().at(-1)!;
  const newDocs: number[] = [];

  if (from <= until) {
    for (const acc of link.accounts.filter((a) => a.enabled)) {
      try {
        const txs: EbTransaction[] = await listTransactions(acc.uid, from, until);
        const { keys, refs } = await knownKeys(companyId, acc.uid, from);
        for (const b of dailyBatches(txs, { since: from, until, known: keys })) {
          let ref = `${refPrefix(acc.uid)}${b.date}`;
          for (let n = 2; refs.has(ref); n++) ref = `${refPrefix(acc.uid)}${b.date}:${n}`; // utólag könyvelt tétel ugyanarra a napra
          refs.add(ref);
          const payload = JSON.stringify({ provider: "enablebanking", account: { iban: acc.iban, currency: acc.currency }, date: b.date, keys: b.keys, transactions: b.transactions });
          const data = Buffer.from(payload, "utf8").toString("base64");
          const [row] = await db.insert(inboxDocuments).values({
            companyId, source: "bank", sourceRef: ref, kind: "statement",
            filename: `Bank ${acc.iban ?? acc.name ?? acc.uid.slice(0, 8)} ${b.date}.json`, mime: "application/json",
            sha256: createHash("sha256").update(payload).digest("hex"), data,
            emailSubject: `Banki tételek ${b.date} (${b.transactions.length} db)`, emailDate: new Date(`${b.date}T12:00:00Z`),
            status: "extracted", extracted: batchToExtracted(b, { iban: acc.iban, currency: acc.currency }),
          }).onConflictDoNothing().returning({ id: inboxDocuments.id });
          if (row) { newDocs.push(row.id); res.days++; res.transactions += b.transactions.length; }
        }
      } catch (e) {
        const err = e as Error & { status?: number };
        res.errors.push(err.status === 401 || err.status === 403 || err.status === 422
          ? `${acc.iban ?? acc.uid}: a bank elutasította a lekérést – valószínűleg lejárt vagy visszavont hozzájárulás, kapcsold össze újra. (${err.message})`
          : `${acc.iban ?? acc.uid}: ${err.message}`);
      }
    }
  }

  // feldolgozás időrendben (a javaslat a korábbi napok könyveléseit már látja)
  if (newDocs.length) {
    const docs = await db.select({ id: inboxDocuments.id }).from(inboxDocuments).where(inArray(inboxDocuments.id, newDocs)).orderBy(asc(inboxDocuments.emailDate), asc(inboxDocuments.id));
    for (const d of docs) {
      try {
        const r = await processDocument(companyId, d.id, userId, { autoPost: settings.autoPost !== false, ctx: await loadProposeCtx(companyId) });
        if (r === "booked") res.booked++;
        else if (r === "review") res.review++;
      } catch (e) {
        res.errors.push(`#${d.id}: ${(e as Error).message}`);
        await db.update(inboxDocuments).set({ status: "error", error: (e as Error).message }).where(eq(inboxDocuments.id, d.id));
      }
    }
  }

  res.warning = consentWarning(link, now) ?? undefined;
  const summary = res.days
    ? `${res.transactions} tranzakció ${res.days} napról – ${res.booked} nap lekönyvelve, ${res.review} jóváhagyásra vár.`
    : "Nincs új könyvelt banki tétel.";
  const fresh = (await getInboxSettings(companyId)).settings; // közben módosulhatott (pl. a felhasználó mentett)
  if (fresh.bank) await saveInboxSettings(companyId, { ...fresh, bank: { ...fresh.bank, lastRunAt: new Date().toISOString(), lastResult: summary, lastError: res.errors.join(" | ") || res.warning || null } });
  return res;
}

/** Az ütemező hívja: minden olyan cég, amelyhez banki kapcsolat tartozik. */
export async function runBankSyncAll(): Promise<BankSyncResult[]> {
  const rows = await db.select({ companyId: inboxSettings.companyId, settings: inboxSettings.settings }).from(inboxSettings);
  const out: BankSyncResult[] = [];
  for (const r of rows.filter((x) => x.settings?.bank)) {
    try { out.push(await runBankSync(r.companyId)); }
    catch (e) { out.push({ companyId: r.companyId, days: 0, transactions: 0, booked: 0, review: 0, errors: [(e as Error).message] }); }
  }
  return out;
}
