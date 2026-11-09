/**
 * Árfolyam szabályok – tiszta függvények (kliensen és szerveren is használható).
 *
 * Áfa tv. 80. § (1): az átszámítás időpontja
 *   a) előlegnél az előleg átvétele,           (később: előlegszámlák)
 *   b) időszakos elszámolásnál (58. §) a számla kibocsátása,
 *   c) egyéb esetben a teljesítés.
 * Közösségen belüli beszerzésnél a fizetendő adó megállapításának napja (Áfa tv. 63. §):
 *   a számla kibocsátása, de legkésőbb a teljesítést követő hónap 15. napja.
 * Szt. 60. § (5a): a devizás követelés / kötelezettség forintértéke az ÁFA alapnál
 *   alkalmazott árfolyamon (számviteli politikában rögzítve) – így egy számlán egy árfolyam van.
 */

export type RateDateInput = {
  issueDate: string;
  fulfillmentDate: string;
  periodic: boolean;
  /** A számlán szereplő ÁFA-kódok jellege. */
  vatKinds: string[];
};

export function fifteenthOfNextMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-15`;
}

export function vatRateDate(i: RateDateInput): { date: string; rule: string } {
  if (i.vatKinds.includes("eu_acquisition")) {
    const limit = fifteenthOfNextMonth(i.fulfillmentDate);
    return i.issueDate && i.issueDate < limit
      ? { date: i.issueDate, rule: "KBB: számla kibocsátásának napja (Áfa tv. 63. §)" }
      : { date: limit, rule: "KBB: teljesítést követő hónap 15. napja (Áfa tv. 63. §)" };
  }
  if (i.periodic) return { date: i.issueDate, rule: "Időszakos elszámolás: számla kibocsátásának napja (Áfa tv. 80. § (1) b)" };
  return { date: i.fulfillmentDate, rule: "Teljesítés napja (Áfa tv. 80. § (1) c)" };
}

export type MnbRate = { date: string; currency: string; rate: number };

/** Az MNB GetExchangeRates válasz (beágyazott, escape-elt XML) feldolgozása. Ft / 1 egység. */
export function parseMnbResponse(body: string): MnbRate[] {
  const unescaped = body
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  const out: MnbRate[] = [];
  const dayRe = /<Day date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Day>/g;
  let d: RegExpExecArray | null;
  while ((d = dayRe.exec(unescaped))) {
    const rateRe = /<Rate unit="(\d+)" curr="([A-Z]{3})">([\d.,]+)<\/Rate>/g;
    let r: RegExpExecArray | null;
    while ((r = rateRe.exec(d[2]))) {
      const unit = Number(r[1]) || 1;
      const value = Number(r[3].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(value) && value > 0) out.push({ date: d[1], currency: r[2], rate: Math.round((value / unit) * 1e6) / 1e6 });
    }
  }
  return out;
}

export function mnbSoapEnvelope(start: string, end: string, currencies: string[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://www.mnb.hu/webservices/">' +
    "<soap:Body><web:GetExchangeRates>" +
    `<web:startDate>${start}</web:startDate><web:endDate>${end}</web:endDate>` +
    `<web:currencyNames>${currencies.join(",")}</web:currencyNames>` +
    "</web:GetExchangeRates></soap:Body></soap:Envelope>"
  );
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
