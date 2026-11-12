/**
 * v2.0 – Vendégház elemzés: adatbetöltés a főkönyvből → napi tényadatok (gh-calc.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, invoiceLines, invoices, journalEntries, journalLines, type TaxProfile } from "@/db/schema";
import { DEFAULT_TAX_PROFILE, type PnlTaxInclude } from "./entity";
import { today } from "./dates";
import {
  Daily,
  addDays,
  addTaxes,
  daysBetween,
  bookingCode,
  cfKey,
  guestName,
  isMoney,
  nightChannel,
  nightsOf,
  pnlKey,
  spread,
  type Day,
} from "./gh-calc";

export type Stay = {
  code: string;
  guest: string | null;
  channel: "airbnb" | "booking" | "direct";
  from: string;
  to: string;
  nights: number;
  amount: number;
  bookedOn: string | null;
};

export type GhData = {
  days: Day[];
  first: string;
  asOf: string;
  include: PnlTaxInclude;
  rate: number;
  base: number;
  t0: string | null;
  stays: Stay[];
  profile: TaxProfile;
};

export const DEFAULT_DISCOUNT_RATE = 0.06;

export async function loadGuesthouse(companyId: number, profile: TaxProfile | null, asOf = today()): Promise<GhData> {
  const p = profile ?? DEFAULT_TAX_PROFILE;
  const [lines, invLines, notes] = await Promise.all([
    db
      .select({
        entryId: journalEntries.id,
        date: journalEntries.date,
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
        reversed: sql<boolean>`(${journalEntries.reversedById} is not null or ${journalEntries.reversalOfId} is not null)`,
        entryText: journalEntries.description,
        lineText: journalLines.description,
        code: accounts.code,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.companyId, companyId)),
    db
      .select({ invoiceId: invoiceLines.invoiceId, code: accounts.code, gross: invoiceLines.grossHuf })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
      .where(eq(invoices.companyId, companyId)),
    db
      .select({ number: invoices.invoiceNumber, note: invoices.note })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), sql`${invoices.note} like '%foglalva%'`)),
  ]);

  const daily = new Daily();
  const invW = new Map<number, Array<{ key: string; w: number }>>();
  for (const l of invLines) {
    const arr = invW.get(l.invoiceId) ?? [];
    arr.push({ key: cfKey(l.code), w: Number(l.gross) });
    invW.set(l.invoiceId, arr);
  }

  const byEntry = new Map<number, typeof lines>();
  const stays = new Map<string, Stay>();
  let first = asOf;
  let activityStart: string | null = null;
  let base = 0;
  let t0: string | null = null;

  // a sztornózott tételek és a sztornók együtt nullák – mindkettőt kihagyjuk (így az éjszakák sem duplázódnak)
  const live = lines.filter((l) => !l.reversed);
  // foglaláskód → tartózkodás: a kód nélküli dátumú sorok (Airbnb jutalék, takarítási díj, módosítás) is a vendégéjszakákra kerüljenek
  const codeRange = new Map<string, { from: string; days: number }>();
  for (const l of live) {
    const text = l.lineText || l.entryText;
    const code = bookingCode(text);
    if (!code || codeRange.has(code)) continue;
    const sp = spread(l.date, text);
    if (sp.exact) codeRange.set(code, { from: sp.from, days: sp.days });
  }
  for (const l of live) {
    const arr = byEntry.get(l.entryId) ?? [];
    arr.push(l);
    byEntry.set(l.entryId, arr);
    if (l.date < first) first = l.date;
    const dc = Number(l.debit) - Number(l.credit);
    const text = l.lineText || l.entryText;

    if (l.code.startsWith("12")) {
      base += dc;
      if (dc > 0 && (!t0 || l.date < t0)) t0 = l.date;
    }

    const key = pnlKey(l.code);
    if (key) {
      const amount = key.startsWith("rev_") ? -dc : dc;
      let sp = spread(l.date, text);
      if (!sp.exact) {
        const cr = codeRange.get(bookingCode(text) ?? "");
        if (cr) sp = { ...cr, exact: false };
      }
      daily.addSpread(sp.from, sp.days, key, amount);
      const ch = nightChannel(l.code);
      if (ch && amount > 0) {
        const ms = `${sp.from.slice(0, 7)}-01`;
        if (!activityStart || ms < activityStart) activityStart = ms;
      }
      const n = nightsOf(l.code, text, amount);
      if (ch && n.nights > 0) {
        const code = bookingCode(text);
        if (n.exact) {
          const sk = code ?? `${ch}:${sp.from}`;
          if (!stays.has(sk)) {
            stays.set(sk, { code: sk, guest: guestName(text), channel: ch, from: sp.from, to: sp.from, nights: n.nights, amount: 0, bookedOn: null });
            for (let i = 0; i < n.nights; i++) {
              const day = addDays(sp.from, i);
              daily.add(day, `n_${ch}`, 1);
              if (ch === "airbnb") daily.add(day, "n_airbnb_exact", 1);
            }
            daily.add(sp.from, `stays_${ch}`, 1);
          }
        } else {
          daily.addSpread(sp.from, sp.days, `n_${ch}`, n.nights);
          daily.addSpread(sp.from, sp.days, "n_est", n.nights);
        }
      }
    }
  }

  // foglalások: távozás napja, foglalás dátuma
  const booked = new Map<string, string>();
  for (const n of notes) {
    const m = n.note?.match(/foglalva (\d{4}-\d{2}-\d{2})/);
    const c = n.number.match(/^AB-([A-Z0-9]+)$/);
    if (m && c) booked.set(c[1], m[1]);
  }
  for (const s of stays.values()) {
    s.to = addDays(s.from, s.nights);
    s.bookedOn = booked.get(s.code) ?? null;
  }
  // foglalásonkénti összeg: szállásdíj + takarítási díj, a későbbi módosításokkal együtt
  for (const l of live) {
    const text = l.lineText || l.entryText;
    const code = bookingCode(text);
    const key = pnlKey(l.code);
    if (!code || !key || !key.startsWith("rev_") || key === "rev_other") continue;
    const s = stays.get(code);
    if (s) s.amount += Number(l.credit) - Number(l.debit);
  }

  // az 389-es átvezetésen keresztül kiegyenlített számlák (pl. magánpénzből fizetett rezsi): összeg szerinti párosítás
  const clearing: Array<{ date: string; amount: number; invoiceId: number; used: boolean }> = [];
  for (const [, ls] of byEntry) {
    if (ls[0].sourceType !== "payment" || !ls[0].sourceId) continue;
    for (const l of ls) if (l.code.startsWith("389")) clearing.push({ date: l.date, amount: Math.abs(Number(l.debit) - Number(l.credit)), invoiceId: ls[0].sourceId, used: false });
  }
  const matchClearing = (date: string, amount: number) => {
    let best: (typeof clearing)[number] | null = null;
    for (const c of clearing) {
      if (c.used || Math.abs(c.amount - amount) > 0.5) continue;
      if (!best || Math.abs(daysBetween(c.date, date)) < Math.abs(daysBetween(best.date, date))) best = c;
    }
    if (best) best.used = true;
    return best?.invoiceId;
  };

  // cash flow: tételenként a pénzszámlák nettó mozgása, az ellenoldal (vagy a kiegyenlített számla) szerint
  for (const [, ls] of byEntry) {
    const money = ls.filter((l) => isMoney(l.code)).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
    if (Math.abs(money) < 0.5) continue;
    const date = ls[0].date;
    // kiegyenlítésnél a tétel forrása maga a számla
    let invId = ls[0].sourceType === "payment" && ls[0].sourceId ? ls[0].sourceId : undefined;
    if (!invId && ls.every((l) => isMoney(l.code) || l.code.startsWith("389"))) invId = matchClearing(date, Math.abs(money));
    const weights = invId ? invW.get(invId) : undefined;
    if (weights && weights.length) {
      const sum = weights.reduce((a, w) => a + w.w, 0);
      if (Math.abs(sum) > 0.005) {
        for (const w of weights) daily.add(date, `cf_${w.key}`, (money * w.w) / sum);
        continue;
      }
    }
    for (const l of ls) {
      if (isMoney(l.code)) continue;
      daily.add(date, `cf_${cfKey(l.code)}`, -(Number(l.debit) - Number(l.credit)));
    }
  }

  const pre = daily.days();
  addTaxes(daily, pre, {
    flatAnnual: p.szjaMethod === "flat_rate_room" ? Math.max(1, p.rooms) * p.flatRatePerRoom : null,
    ifaPerNight: p.ifaPerNight ?? null,
    ifaAvgGuests: p.ifaAvgGuests ?? null,
    activityStart,
    asOf,
  });

  return {
    days: daily.days(),
    first,
    asOf,
    include: p.pnlTaxInclude ?? "both",
    rate: p.discountRate ?? DEFAULT_DISCOUNT_RATE,
    base,
    t0,
    stays: [...stays.values()].sort((a, b) => (a.from < b.from ? 1 : -1)),
    profile: p,
  };
}
