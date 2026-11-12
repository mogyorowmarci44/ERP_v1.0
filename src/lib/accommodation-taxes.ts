/**
 * v2.0 – Szálláshely-adók (TFH, IFA) csatornánként és a P&L-hez – adatbázis-lekérdezések.
 * A számítási szabályok (csatornák, felfüggesztés, P&L-választás) tiszta függvényként az entity.ts-ben vannak.
 */
import { and, between, eq, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, invoiceLines, invoices, journalEntries, journalLines, type TaxProfile } from "@/db/schema";
import {
  DEFAULT_TAX_PROFILE,
  flatRateSchedule,
  ifaByChannel,
  nightsFromText,
  pnlPick,
  revenueAndCosts,
  revenueChannel,
  tfhByChannel,
  zeroCh,
  type ChannelAmounts,
  type PnlTaxInclude,
} from "./entity";
import { trialBalance } from "./reports";
import { round2 } from "./money";

/** Szállásdíj-bevétel (91x) havonta és számlánként (követel − tartozik). */
export async function monthlyAccommodationRevenue(companyId: number, from: string, to: string) {
  const rows = await db
    .select({
      month: sql<string>`to_char(${journalEntries.date}, 'YYYY-MM')`,
      code: accounts.code,
      amount: sql<number>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)::float8`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.companyId, companyId), between(journalEntries.date, from, to), like(accounts.code, "91%")))
    .groupBy(sql`1`, accounts.code);
  return rows.map((r) => ({ month: r.month, code: r.code, amount: round2(Number(r.amount)) }));
}

/** Vendégéjszakák becslése a bevételi számlák soraiból („N éj”), csatornánként. */
export async function estimatedNights(companyId: number, from: string, to: string): Promise<ChannelAmounts> {
  const rows = await db
    .select({ code: accounts.code, description: invoiceLines.description })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(accounts, eq(accounts.id, invoiceLines.accountId))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.direction, "out"),
        eq(invoices.status, "posted"),
        between(invoices.fulfillmentDate, from, to),
        or(like(accounts.code, "911%"), like(accounts.code, "912%"), like(accounts.code, "913%")),
      ),
    );
  const n = zeroCh();
  for (const r of rows) {
    const ch = revenueChannel(r.code);
    if (ch) n[ch] += nightsFromText(r.description);
  }
  return n;
}

export type AccommodationYear = {
  year: number;
  revenue: ChannelAmounts;
  tfh: ReturnType<typeof tfhByChannel>;
  nights: ChannelAmounts;
  nightsEstimated: ChannelAmounts;
  nightsOverridden: { platform: boolean; direct: boolean };
  ifa: ChannelAmounts | null;
  include: PnlTaxInclude;
  pnl: {
    revenue: number;
    otherIncome: number;
    costs: number;
    tfh: number;
    ifa: number;
    beforeSzja: number;
    szja: number;
    net: number;
  };
};

/** Egy év szálláshely-adói és P&L-je a választott TFH/IFA-beszámítással. */
export async function accommodationYear(
  companyId: number,
  profile: TaxProfile | null,
  year: number,
  asOf?: string,
  includeOverride?: PnlTaxInclude,
): Promise<AccommodationYear> {
  const p = profile ?? DEFAULT_TAX_PROFILE;
  const from = `${year}-01-01`;
  const to = asOf && asOf < `${year}-12-31` ? asOf : `${year}-12-31`;
  const [monthly, est, tb] = await Promise.all([
    monthlyAccommodationRevenue(companyId, from, to),
    estimatedNights(companyId, from, to),
    trialBalance(companyId, from, to),
  ]);
  const revenue = zeroCh();
  for (const r of monthly) {
    const ch = revenueChannel(r.code);
    if (ch) revenue[ch] = round2(revenue[ch] + r.amount);
  }
  const tfh = tfhByChannel(monthly);
  const ov = p.ifaNights?.[String(year)] ?? {};
  const nights: ChannelAmounts = {
    platform: ov.platform ?? est.platform,
    direct: ov.direct ?? est.direct,
  };
  const ifa = ifaByChannel(nights, p.ifaAvgGuests, p.ifaPerNight);
  const include = includeOverride ?? p.pnlTaxInclude ?? "both";

  const { costs } = revenueAndCosts(tb);
  const accRevenue = round2(revenue.platform + revenue.direct);
  // egyéb bevétel: minden 9-es számla a szállásdíjak (91x) és a nem realizált árfolyamnyereség (977) nélkül
  const otherIncome = round2(
    tb.filter((r) => r.code.length > 1 && r.code.startsWith("9") && !r.code.startsWith("91") && !r.code.startsWith("977")).reduce((a, r) => a + r.periodCredit - r.periodDebit, 0),
  );
  const rev = round2(accRevenue + otherIncome);
  const tfhP = pnlPick(tfh.tfh, include);
  const ifaP = pnlPick(ifa, include);
  const beforeSzja = round2(rev - costs - tfhP - ifaP);
  const szja = p.szjaMethod === "flat_rate_room" ? flatRateSchedule(p.rooms, p.flatRatePerRoom, year).annual : 0;
  return {
    year,
    revenue,
    tfh,
    nights,
    nightsEstimated: est,
    nightsOverridden: { platform: ov.platform != null, direct: ov.direct != null },
    ifa,
    include,
    pnl: { revenue: accRevenue, otherIncome, costs, tfh: tfhP, ifa: ifaP, beforeSzja, szja, net: round2(beforeSzja - szja) },
  };
}
