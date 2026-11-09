/** MNB hivatalos árfolyamok lekérése és gyorsítótárazása (fx_rates). */
import { and, desc, eq, lte, gte, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { addDays, mnbSoapEnvelope, parseMnbResponse, type MnbRate } from "./fx";

const MNB_URLS = ["https://www.mnb.hu/arfolyamok.asmx", "http://www.mnb.hu/arfolyamok.asmx"];

export async function fetchMnbRates(start: string, end: string, currencies: string[]): Promise<MnbRate[]> {
  let lastErr: unknown;
  for (const url of MNB_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '"http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetExchangeRates"',
        },
        body: mnbSoapEnvelope(start, end, currencies),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`MNB HTTP ${res.status}`);
      return parseMnbResponse(await res.text());
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Az MNB árfolyam-szolgáltatás nem érhető el (${lastErr instanceof Error ? lastErr.message : lastErr}). Add meg kézzel az árfolyamot.`);
}

export async function storeRates(tx: DbOrTx, rates: MnbRate[], source = "MNB") {
  if (!rates.length) return;
  await tx
    .insert(schema.fxRates)
    .values(rates.map((r) => ({ currency: r.currency, date: r.date, rate: r.rate, source })))
    .onConflictDoUpdate({
      target: [schema.fxRates.currency, schema.fxRates.date],
      set: { rate: sql`excluded.rate`, source: sql`excluded.source`, fetchedAt: sql`now()` },
    });
}

async function latestStored(tx: DbOrTx, currency: string, date: string) {
  const [r] = await tx
    .select()
    .from(schema.fxRates)
    .where(and(eq(schema.fxRates.currency, currency), lte(schema.fxRates.date, date), gte(schema.fxRates.date, addDays(date, -10))))
    .orderBy(desc(schema.fxRates.date))
    .limit(1);
  return r;
}

/**
 * Az adott napon érvényes hivatalos MNB árfolyam: az aznapi, vagy ha aznap nem volt jegyzés
 * (hétvége, ünnep), az utolsó előtte közzétett.
 */
export async function getMnbRate(currency: string, date: string, tx: DbOrTx = db): Promise<{ rate: number; rateDate: string }> {
  if (currency === "HUF") return { rate: 1, rateDate: date };
  let r = await latestStored(tx, currency, date);
  if (!r || r.date !== date) {
    // Lehet, hogy aznap volt jegyzés, csak még nincs letöltve – frissítünk.
    try {
      await storeRates(tx, await fetchMnbRates(addDays(date, -10), date, [currency]));
      r = await latestStored(tx, currency, date);
    } catch (e) {
      if (!r) throw e;
    }
  }
  if (!r) throw new Error(`Nincs MNB árfolyam: ${currency} ${date}. Add meg kézzel.`);
  return { rate: Number(r.rate), rateDate: r.date };
}
