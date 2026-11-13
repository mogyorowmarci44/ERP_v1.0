/**
 * v2.0 – Vendégház adatfrissítés: szinkronfájl (Airbnb-fiókból kiolvasott foglalások, értékelések),
 * Airbnb iCal-naptár, Meta Ads és Instagram (Graph API) – utóbbiak csak megadott hozzáféréssel.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReviewRatings, TaxProfile } from "@/db/schema";
import { parseIcal } from "./ical";

export type SyncReservation = {
  source: "airbnb" | "direct" | "booking";
  code: string;
  guest?: string | null;
  guests?: number | null;
  checkIn: string;
  checkOut: string;
  amount?: number | null;
  status?: string;
  bookedOn?: string | null;
  note?: string | null;
};
export type SyncReview = {
  externalId: string;
  guest?: string | null;
  guestLocation?: string | null;
  stayFrom?: string | null;
  stayTo?: string | null;
  reviewedAt: string;
  overall?: number | null;
  ratings?: ReviewRatings;
  tags?: Record<string, string[]>;
  text?: string | null;
  privateNote?: string | null;
  reply?: string | null;
};
export type SyncBundle = { format: "mm-erp-gh-sync/1"; generatedAt?: string; reservations?: SyncReservation[]; reviews?: SyncReview[] };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function logSync(companyId: number, source: string, ok: boolean, message: string) {
  await db.insert(schema.ghSyncLog).values({ companyId, source, ok, message: message.slice(0, 1000) });
}

/** Szinkronfájl betöltése: foglalások és értékelések felülírással (kód / azonosító szerint), többször is futtatható. */
export async function applySyncBundle(companyId: number, b: SyncBundle): Promise<{ reservations: number; reviews: number }> {
  if (b?.format !== "mm-erp-gh-sync/1") throw new Error("Ez nem vendégház-szinkronfájl (mm-erp-gh-sync/1).");
  const res = b.reservations ?? [], rev = b.reviews ?? [];
  for (const r of res) if (!r.code || !isDate(r.checkIn) || !isDate(r.checkOut) || r.checkOut <= r.checkIn) throw new Error(`Hibás foglalás a fájlban: ${r.code ?? "?"}`);
  for (const r of rev) if (!r.externalId || !isDate(r.reviewedAt)) throw new Error(`Hibás értékelés a fájlban: ${r.externalId ?? "?"}`);
  await db.transaction(async (tx) => {
    for (const r of res) {
      const v = { source: r.source, guest: r.guest ?? null, guests: r.guests ?? null, checkIn: r.checkIn, checkOut: r.checkOut, amount: r.amount ?? null, status: r.status ?? "confirmed", bookedOn: r.bookedOn ?? null, note: r.note ?? null, syncedAt: new Date() };
      await tx.insert(schema.ghReservations).values({ companyId, code: r.code, ...v }).onConflictDoUpdate({ target: [schema.ghReservations.companyId, schema.ghReservations.code], set: v });
    }
    // a fájlban szereplő közvetlen foglalások mellett a naptárból jött névtelen blokkok feleslegesek
    const directIns = res.filter((r) => r.source === "direct").map((r) => r.checkIn);
    if (directIns.length) await tx.delete(schema.ghReservations).where(and(eq(schema.ghReservations.companyId, companyId), eq(schema.ghReservations.source, "ical"), inArray(schema.ghReservations.checkIn, directIns)));
    for (const r of rev) {
      const v = { guest: r.guest ?? null, guestLocation: r.guestLocation ?? null, stayFrom: r.stayFrom ?? null, stayTo: r.stayTo ?? null, reviewedAt: r.reviewedAt, overall: r.overall ?? null, ratings: r.ratings ?? {}, tags: r.tags ?? {}, text: r.text ?? null, privateNote: r.privateNote ?? null, reply: r.reply ?? null, syncedAt: new Date() };
      await tx.insert(schema.ghReviews).values({ companyId, source: "airbnb", externalId: r.externalId, ...v }).onConflictDoUpdate({ target: [schema.ghReviews.companyId, schema.ghReviews.externalId], set: v });
    }
  });
  return { reservations: res.length, reviews: rev.length };
}

// ---------------------------------------------------------------------------
// Airbnb iCal
// ---------------------------------------------------------------------------

async function syncIcal(companyId: number, url: string, today: string): Promise<string> {
  if (!/^https:\/\/(www\.)?airbnb\.[a-z.]+\/calendar\/ical\//.test(url)) throw new Error("Az iCal-cím nem Airbnb naptárexport (https://www.airbnb.com/calendar/ical/…).");
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Airbnb iCal: HTTP ${r.status}`);
  const events = parseIcal(await r.text()).filter((e) => e.end > today);
  const existing = await db.select().from(schema.ghReservations).where(eq(schema.ghReservations.companyId, companyId));
  const byCode = new Map(existing.map((x) => [x.code, x]));
  let added = 0, updated = 0, blocks = 0;
  const seenBlocks: string[] = [];
  for (const e of events) {
    if (e.code) {
      const ex = byCode.get(e.code);
      if (!ex) { await db.insert(schema.ghReservations).values({ companyId, source: "airbnb", code: e.code, checkIn: e.start, checkOut: e.end, note: "iCal-naptárból – a vendég neve és az összeg a szinkronfájllal érkezik" }); added++; }
      else if (ex.checkIn !== e.start || ex.checkOut !== e.end) { await db.update(schema.ghReservations).set({ checkIn: e.start, checkOut: e.end, syncedAt: new Date() }).where(eq(schema.ghReservations.id, ex.id)); updated++; }
    } else {
      // kiblokkolt napok: ha nincs rá névvel rögzített közvetlen foglalás, névtelen blokként mutatjuk
      if (existing.some((x) => x.source === "direct" && x.checkIn < e.end && x.checkOut > e.start)) continue;
      const code = `BLK-${e.start.replaceAll("-", "")}`;
      seenBlocks.push(code);
      const v = { checkIn: e.start, checkOut: e.end, syncedAt: new Date() };
      await db.insert(schema.ghReservations).values({ companyId, source: "ical", code, guest: "Kiblokkolva (Airbnb-naptár)", ...v }).onConflictDoUpdate({ target: [schema.ghReservations.companyId, schema.ghReservations.code], set: v });
      blocks++;
    }
  }
  // megszűnt jövőbeli blokkok törlése; lemondott Airbnb-foglalások jelölése
  const stale = existing.filter((x) => x.source === "ical" && x.checkOut > today && !seenBlocks.includes(x.code)).map((x) => x.id);
  if (stale.length) await db.delete(schema.ghReservations).where(inArray(schema.ghReservations.id, stale));
  const codes = new Set(events.map((e) => e.code).filter(Boolean));
  const gone = existing.filter((x) => x.source === "airbnb" && x.checkIn > today && x.status === "confirmed" && !codes.has(x.code)).map((x) => x.id);
  if (gone.length) await db.update(schema.ghReservations).set({ status: "cancelled", syncedAt: new Date() }).where(inArray(schema.ghReservations.id, gone));
  return `${added} új foglalás, ${updated} módosult, ${gone.length} lemondva, ${blocks} kiblokkolt időszak`;
}

// ---------------------------------------------------------------------------
// Meta Ads + Instagram (Graph API)
// ---------------------------------------------------------------------------

async function graph(path: string, params: Record<string, string>, token: string) {
  const u = new URL(`https://graph.facebook.com/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error(j?.error?.message ?? `Graph API: HTTP ${r.status}`);
  return j;
}

async function syncMetaAds(companyId: number, token: string, account: string, today: string): Promise<string> {
  const act = account.startsWith("act_") ? account : `act_${account}`;
  const since = new Date(Date.parse(today) - 89 * 86400000).toISOString().slice(0, 10);
  let rows: Array<{ date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string }> = [];
  let j = await graph(`${act}/insights`, { fields: "spend,impressions,reach,clicks", time_increment: "1", time_range: JSON.stringify({ since, until: today }), limit: "200" }, token);
  rows = rows.concat(j.data ?? []);
  for (let i = 0; i < 5 && j.paging?.cursors?.after && j.paging?.next; i++) {
    j = await graph(`${act}/insights`, { fields: "spend,impressions,reach,clicks", time_increment: "1", time_range: JSON.stringify({ since, until: today }), limit: "200", after: j.paging.cursors.after }, token);
    rows = rows.concat(j.data ?? []);
  }
  for (const r of rows) {
    const v = { spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0) };
    await db.insert(schema.ghAdStats).values({ companyId, date: r.date_start, ...v }).onConflictDoUpdate({ target: [schema.ghAdStats.companyId, schema.ghAdStats.date], set: v });
  }
  const spend = rows.reduce((a, r) => a + Number(r.spend ?? 0), 0);
  return `${rows.length} nap frissítve (utolsó 90 nap költése: ${Math.round(spend).toLocaleString("hu-HU")})`;
}

async function syncInstagram(token: string, igUserId: string): Promise<string> {
  const j = await graph(igUserId, { fields: "username,followers_count,media_count" }, token);
  return `@${j.username}: ${j.followers_count} követő, ${j.media_count} bejegyzés`;
}

export type SyncSettings = NonNullable<TaxProfile["sync"]>;

/** „Minden adat frissítése”: minden beállított forrást lefuttat, az eredményt naplózza. */
export async function refreshAll(companyId: number, s: SyncSettings | undefined, today: string) {
  const results: Array<{ source: string; ok: boolean; message: string }> = [];
  const run = async (source: string, configured: boolean, hint: string, fn: () => Promise<string>) => {
    if (!configured) { results.push({ source, ok: false, message: `nincs beállítva – ${hint}` }); return; }
    try { results.push({ source, ok: true, message: await fn() }); } catch (e) { results.push({ source, ok: false, message: e instanceof Error ? e.message : String(e) }); }
  };
  await run("Airbnb naptár (iCal)", !!s?.airbnbIcalUrl, "add meg az Airbnb naptárexport címét", () => syncIcal(companyId, s!.airbnbIcalUrl!, today));
  await run("Meta Ads", !!(s?.metaToken && s?.metaAdAccount), "kell hozzá Meta hozzáférési token és hirdetési fiók azonosító", () => syncMetaAds(companyId, s!.metaToken!, s!.metaAdAccount!, today));
  await run("Instagram", !!(s?.metaToken && s?.igUserId), "kell hozzá Meta token és Instagram-fiók azonosító", () => syncInstagram(s!.metaToken!, s!.igUserId!));
  for (const r of results) await logSync(companyId, r.source, r.ok, r.message);
  return results;
}

/** Forrásonként az utolsó naplóbejegyzés. */
export async function lastSyncs(companyId: number) {
  const rows = await db.execute(sql`select distinct on (source) source, ok, message, at from gh_sync_log where company_id = ${companyId} order by source, at desc`);
  return ((rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as Array<{ source: string; ok: boolean; message: string; at: string | Date }>;
}
