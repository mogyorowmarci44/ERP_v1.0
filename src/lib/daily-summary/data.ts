/**
 * v3.9.2 – Napi összefoglaló: adatgyűjtés cégenként és holding szinten.
 * Minden szám a könyvelésből jön (ugyanazok a riportfüggvények, mint a felületen), a „tegnap” a küldés előtti nap.
 */
import "server-only";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { trialBalance, openItems, journalList, vatAnalytics, type TrialBalanceRow } from "@/lib/reports";
import { addDaysIso, monthStart, today } from "@/lib/dates";
import { isPrivate } from "@/lib/entity";
import { nextVatDeadline } from "@/lib/vat-deadline";
import { cashSplit, isCashAccount } from "@/lib/cash-split";
import { unclosedVatPeriods } from "@/lib/vat-closing";
import { consistencyCounts } from "@/lib/consistency";
import { companyKpis, operationStartOf } from "@/lib/kpi";
import { salesGap } from "@/lib/sales-gap";
import { filingsOverview } from "@/lib/filings";
import { loadStockCars, loadSoldCars, redDaysOf } from "@/lib/keszlet-merleg";
import { stockView, soldView, type KmStatus } from "@/lib/keszlet-merleg-calc";
import { loadForecastInput } from "@/lib/forecast-data";
import { runForecast } from "@/lib/forecast";
import { moneyMonitor } from "@/lib/money-monitor";
import { loadGuesthouse } from "@/lib/guesthouse";
import { kpis, sumRange } from "@/lib/gh-calc";
import { accommodationStart, availableDays } from "@/lib/gh-view";
import { MEMBER_LOAN_ACCOUNT } from "@/lib/member-loans";
import { draftCounts, draftText } from "@/lib/drafts";
import { numberToHungarian } from "@/lib/hu-words";
import { dueDate, formFor, nextWorkday } from "@/lib/anyk";

const periodKey = (d: string) => d.slice(0, 7);
import { money } from "./format";

export type Level = "red" | "yellow" | "green";
export type Todo = { level: Level; text: string; path: string };
export type CarRow = { title: string; days: number | null; holding: number; status: KmStatus; note: string };
export type EntryRow = { label: string; amount: number; debit: string; credit: string };

export type CompanySnapshot = {
  companyId: number;
  name: string;
  private: boolean;
  date: string; // a küldés napja
  day: string; // a „tegnap”
  headline: string;
  kpi: { cash: number; cashHuf: number; /** v4.2.0 – EUR-pénztár mai árfolyamon (Ft) és euróban. */ cashEur: number; cashEurFx: number; liquidity: number; revenueDay: number; revenue30: number; bank: number; stock: number | null; lateReceivable: number; lateReceivableCount: number; latePayable: number; latePayableCount: number };
  /** v3.9.5 – a készlet értéke: beszerzési ár × (1 + medián bruttó fedezet %). */
  stockValue: { purchase: number; value: number; pct: number | null; count: number } | null;
  /** v3.9.4 – eredmények: folyó hó / negyedév / év (tény) és teljes év a Forecast alapján. */
  results: { month: number; quarter: number; year: number; yearForecast: number | null; yearForecastAfterTax: number | null; forecastPartial: boolean;
    /** v4.3.0 – a Forecast évi bontása: tény + terv − HIPA = yearForecast. */ yearBreakdown?: { actual: number; plan: number; hipa: number; tao: number } | null };
  /** v3.9.4 – következő bevallási határidők. */
  deadlines: { vat: { date: string; days: number } | null; payroll: { date: string; days: number } | null };
  todos: Todo[];
  cars: null | {
    daysSinceSale: number | null;
    capital: number;
    avgDays: number | null;
    soldDay: Array<{ title: string; f2: number }>;
    lanes: Record<KmStatus, { count: number; capital: number; holding: number }>;
    top: CarRow[];
    greenCount: number;
  };
  finance: {
    entries: EntryRow[];
    entryCount: number;
    mtdResult: number;
    prevMtdResult: number;
    vatBalance: number; // + = fizetendő
    cashIn30: number | null;
  };
  /** Holding nézethez. */
  extra: {
    mtdRevenue: number;
    ytdResult: number;
    taxLiability: number;
    payablesDue14: number;
    memberLoans: number;
    cashSeries: number[]; // utolsó 30 nap záró pénzeszköz
    guesthouse: null | { occupancy: number | null; nextStay: string | null; nights: number };
  };
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const balOf = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
const periodOf = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0);
/** Eredmény az időszak forgalmából: bevétel (9) − ráfordítás (5, 8). */
// v4.3.0 – a 89 (társasági adó) nélkül, pontosan úgy, mint a Forecast „tény” része
const resultOf = (tb: TrialBalanceRow[]) => -periodOf(tb, (c) => c.startsWith("9")) - periodOf(tb, (c) => c.startsWith("5") || (c.startsWith("8") && !c.startsWith("89")));
const revenueOf = (tb: TrialBalanceRow[]) => -periodOf(tb, (c) => c.startsWith("9"));
const toHuf = (r: { currency: string; openFx: number; grossHuf: string | number; grossFx: string | number }) =>
  r.currency === "HUF" ? r.openFx : (r.openFx * Number(r.grossHuf)) / Number(r.grossFx || 1);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const eFt = (n: number) => money(n);
const HU_MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
/** „októberi”, „augusztusi” – a hónap neve melléknévként; névelő: „az októberi”, „a novemberi”. */
const monthHu = (p: string) => HU_MONTH[Number(p.slice(5, 7)) - 1];
const an = (p: string) => (/^[aáeéiíoóöőuúüű]/.test(HU_MONTH[Number(p.slice(5, 7)) - 1]) ? "z" : "");
const SHORT_M = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
const shortHu = (d: string) => `${SHORT_M[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.`;
/** Előző hónap azonos napja (rövidebb hónapnál a hónap vége). */
function prevMonthSameDay(t: string): string {
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1;
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(Number(t.slice(8, 10)), last)).padStart(2, "0")}`;
}

const INBOX_TODO = ["review", "error", "new", "extracted"];

export async function companySnapshot(cid: number, t = today()): Promise<CompanySnapshot> {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  if (!company) throw new Error(`Nincs ilyen cég: ${cid}`);
  const priv = isPrivate(company);
  const day = addDaysIso(t, -1);
  const ms = monthStart(t);
  const pt = prevMonthSameDay(t);

  const qs = `${t.slice(0, 5)}${String(Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const settings = company.settings as { summaryExcludeVehicles?: number[] | null };
  const excluded = new Set(settings?.summaryExcludeVehicles ?? []);
  const [tbDay, tbMtd, tbPrev, tbYtd, tbNow, recv, pay, cash, vat, [inbox], drafts, tbQtd, tb30] = await Promise.all([
    trialBalance(cid, day, day),
    trialBalance(cid, ms, t),
    trialBalance(cid, monthStart(pt), pt),
    trialBalance(cid, `${t.slice(0, 4)}-01-01`, t),
    trialBalance(cid, t, t),
    openItems(cid, "out"),
    openItems(cid, "in"),
    cashSplit(cid, t),
    vatAnalytics(cid, ms, t),
    db.select({ n: count() }).from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.companyId, cid), inArray(schema.inboxDocuments.status, INBOX_TODO))),
    draftCounts(cid),
    trialBalance(cid, qs, t),
    // v3.9.9 – csúszó 30 nap: a tegnappal záruló 30 nap (nem naptári hónap)
    trialBalance(cid, addDaysIso(day, -29), day),
  ]);
  const cashTotal = sum(cash.map((c) => c.huf));
  const recvLate = recv.filter((r) => r.dueDate && r.dueDate < t);
  const payLate = pay.filter((r) => r.dueDate && r.dueDate < t);
  const p = `/c/${cid}`;

  // --- Teendők -----------------------------------------------------------
  const todos: Todo[] = [];
  for (const c of cash) if (c.huf < -0.5 && c.key.startsWith("cash")) todos.push({ level: "red", text: `Negatív pénztáregyenleg (${c.label}): ${eFt(c.huf)}`, path: `${p}/money` });
  let payrollDeadline: CompanySnapshot["deadlines"]["payroll"] = null;
  if (!priv) {
    try {
      const fo = await filingsOverview(cid);
      if (fo.payroll.length) {
        // a következő járulékbevallás: az előző hó bevallása, ha még nem járt le, különben a folyó hóé
        const prev = periodKey(addDaysIso(monthStart(t), -1));
        const due = dueDate(formFor("payroll", prev), prev) >= t ? dueDate(formFor("payroll", prev), prev) : dueDate(formFor("payroll", periodKey(t)), periodKey(t));
        payrollDeadline = { date: due, days: daysBetween(t, due) };
      }
      for (const r of fo.vat) {
        if (r.status === "missing") todos.push({ level: "red", text: `A${an(r.period)} ${monthHu(r.period)}i ÁFA-bevallás még nincs beadva (határidő ${shortHu(r.due)} volt)`, path: `${p}/filings` });
        else if (r.status === "due") todos.push({ level: "yellow", text: `A${an(r.period)} ${monthHu(r.period)}i ÁFA-bevallást ${shortHu(r.due).slice(0, -1)}-ig be kell adni`, path: `${p}/filings` });
      }
      for (const r of fo.payroll) {
        if (r.status === "missing") todos.push({ level: "red", text: `A${an(r.period)} ${monthHu(r.period)}i járulékbevallás még nincs beadva`, path: `${p}/filings` });
        else if (r.status === "due") todos.push({ level: "yellow", text: `A${an(r.period)} ${monthHu(r.period)}i járulékbevallást ${shortHu(r.due).slice(0, -1)}-ig be kell adni`, path: `${p}/filings` });
      }
    } catch {
      /* a bevallás-áttekintő hibája ne állítsa meg az e-mailt */
    }
  }
  if (recvLate.length) todos.push({ level: "yellow", text: `${recvLate.length} vevőszámlát már ki kellett volna fizetni nekünk · ${eFt(sum(recvLate.map(toHuf)))}`, path: `${p}/reports/open-items` });
  if (payLate.length) todos.push({ level: "yellow", text: `${payLate.length} szállítói számla fizetési határideje lejárt · ${eFt(sum(payLate.map(toHuf)))}`, path: `${p}/reports/open-items` });
  if (inbox.n) todos.push({ level: "yellow", text: `${inbox.n} beérkező bizonylat vár könyvelésre`, path: `${p}/inbox` });
  if (drafts.total) todos.push({ level: "yellow", text: draftText(drafts), path: drafts.href });
  const vatOpen = await unclosedVatPeriods(cid).catch(() => []);
  if (vatOpen.length) todos.push({ level: "yellow", text: `${vatOpen.length} lejárt ÁFA-időszakot még le kell zárni a könyvelésben`, path: `${p}/reports/vat/closing` });
  // v3.9.6: az Egyezőség oldal hibái / figyelmeztetései
  const cons = await consistencyCounts(cid).catch(() => ({ errors: 0, warnings: 0 }));
  if (cons.errors) todos.push({ level: "red", text: `${cons.errors} egyezőségi hiba a könyvelésben (pl. nyitott tétel ↔ főkönyv, ÁFA-befizetés)`, path: `${p}/reports/consistency` });
  else if (cons.warnings) todos.push({ level: "yellow", text: `${cons.warnings} egyezőségi figyelmeztetés (pl. ÁFA-zárás, partner-duplikátum)`, path: `${p}/reports/consistency` });
  // v3.9.4: az időbeli elhatárolások nem kerülnek a napi összefoglalóba
  let vatDeadline: CompanySnapshot["deadlines"]["vat"] = null;
  if (!priv) {
    const vatDue = nextWorkday(nextVatDeadline(company.vatPeriod, t));
    vatDeadline = { date: vatDue, days: daysBetween(t, vatDue) };
    if (vatDeadline.days <= 5) todos.push({ level: "yellow", text: `ÁFA-bevallás határideje ${vatDue.replaceAll("-", ".")}. (${vatDeadline.days} nap)`, path: `${p}/filings` });
  }
  if (payrollDeadline && payrollDeadline.days <= 5) todos.push({ level: "yellow", text: `Járulékbevallás határideje ${payrollDeadline.date.replaceAll("-", ".")}. (${payrollDeadline.days} nap)`, path: `${p}/filings` });
  todos.sort((a, b) => "ryg".indexOf(a.level[0]) - "ryg".indexOf(b.level[0]));

  // --- Autók -------------------------------------------------------------
  let cars: CompanySnapshot["cars"] = null;
  if (!priv) {
    const [stockAll, soldCars, redDays, saleRows, opStart] = await Promise.all([
      loadStockCars(cid),
      loadSoldCars(cid, day, day),
      redDaysOf(cid),
      db.execute(sql`select distinct i.fulfillment_date::text d from invoice_lines il join invoices i on i.id = il.invoice_id
        where i.company_id = ${cid} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null`) as unknown as Promise<Array<{ d: string }>>,
      operationStartOf(cid),
    ]);
    const stockCars = stockAll.filter((c) => !excluded.has(c.id));
    const sv = stockView(stockCars, redDays);
    const sold = soldView(soldCars);
    const lane = (rows: typeof sv.red) => ({ count: rows.length, capital: sum(rows.map((x) => x.r.capital)), holding: sum(rows.map((x) => x.r.holding)) });
    const days = sv.rows.map((x) => x.r.days).filter((d): d is number => d != null);
    const note = (x: (typeof sv.rows)[number]) => {
      if (x.status === "red") return x.r.price < x.r.floor ? `a mostani áron már veszteséges (nullszaldó: ${eFt(x.r.floor)})` : `${x.r.daysToFloor} nap múlva elfogy rajta a nyereség`;
      if (x.status === "yellow") return `most ${eFt(x.r.price)}, a célár ${eFt(x.r.goal)}`;
      return "";
    };
    cars = {
      daysSinceSale: salesGap(saleRows.map((r) => r.d), opStart, t).daysSince,
      capital: sv.totals.capital,
      avgDays: days.length ? Math.round(sum(days) / days.length) : null,
      soldDay: sold.rows.map((x) => ({ title: x.title, f2: x.r.f2 })),
      lanes: { red: lane(sv.red), yellow: lane(sv.yellow), green: lane(sv.green) },
      top: [...sv.red, ...sv.yellow].slice(0, 5).map((x) => ({ title: x.plate ? `${x.title} (${x.plate})` : x.title, days: x.r.days, holding: x.r.holding, status: x.status, note: note(x) })),
      greenCount: sv.green.length,
    };
  }

  // --- Készlet értéke ----------------------------------------------------
  let stockValue: CompanySnapshot["stockValue"] = null;
  if (!priv) {
    try {
      const k = await companyKpis(cid, t);
      if (k) {
        const inStock = k.stock.cars.filter((c) => !excluded.has(c.id));
        const purchase = sum(inStock.map((c) => c.base));
        const pct = k.margin.medF1OnBase;
        stockValue = { purchase, value: purchase * (1 + (pct ?? 0)), pct, count: inStock.length };
      }
    } catch {
      stockValue = null;
    }
  }

  // --- Pénzügyi napló ----------------------------------------------------
  const entries = await journalList(cid, day, day);
  const entryRows: EntryRow[] = entries.map((e) => {
    const deb = [...new Set(e.lines.filter((l) => Number(l.l.debit) > 0).map((l) => l.code))];
    const cre = [...new Set(e.lines.filter((l) => Number(l.l.credit) > 0).map((l) => l.code))];
    return {
      label: `${e.journalCode} · ${e.description ?? e.number}`,
      amount: sum(e.lines.map((l) => Number(l.l.debit))),
      debit: deb.slice(0, 3).join(" / "),
      credit: cre.slice(0, 3).join(" / "),
    };
  });
  let cashIn30: number | null = null;
  let yearFc: { preTax: number; afterTax: number; partial: boolean; actual: number; plan: number; hipa: number; tao: number } | null = null;
  if (!priv) {
    try {
      const fc = runForecast(await loadForecastInput(cid), "base", "week");
      const fy = fc.years[0]; // a Forecast oldal is ezt mutatja (folyó üzleti év)
      if (fy) yearFc = { preTax: fy.preTax, afterTax: fy.afterTax, partial: fy.partial, actual: fy.actualPreTax, plan: fy.forecastPreTax, hipa: fy.hipa, tao: fy.tao };
      const target = addDaysIso(t, 30);
      const w = fc.months.find((m) => m.start <= target && m.end >= target) ?? fc.months.at(-1);
      cashIn30 = w ? w.endCash + w.endBank : null;
    } catch {
      cashIn30 = null;
    }
  }

  // --- Holding kiegészítők ----------------------------------------------
  const taxLiability = Math.max(0, -balOf(tbNow, (c) => c.startsWith("46")));
  const payablesDue14 = sum(pay.filter((r) => !r.dueDate || r.dueDate <= addDaysIso(t, 14)).map(toHuf));
  const memberLoansBal = Math.max(0, -balOf(tbNow, (c) => c.startsWith(MEMBER_LOAN_ACCOUNT)));
  let cashSeries: number[] = [];
  let liquidity = cashTotal;
  // v3.9.10 – bankszámlák külön (mai árfolyamon); a pénztár = összes pénz − bank
  let bank = sum(cash.filter((c) => c.key.startsWith("bank")).map((c) => c.huf));
  try {
    const mm = await moneyMonitor(cid, addDaysIso(t, -29), t, "day");
    // napi értéken: a devizás számlák a mai MNB árfolyamon
    liquidity = sum(mm.accounts.filter((a) => !a.code.startsWith("389")).map((a) => a.revaluedHuf ?? a.balanceHuf));
    bank = sum(mm.accounts.filter((a) => !a.code.startsWith("389") && !isCashAccount(a.code)).map((a) => a.revaluedHuf ?? a.balanceHuf));
    const n = mm.columns.length;
    cashSeries = Array.from({ length: n }, (_, i) => sum(mm.accounts.filter((a) => !a.code.startsWith("389")).map((a) => a.series[i]?.close ?? 0)));
  } catch {
    cashSeries = [];
  }
  let guesthouse: CompanySnapshot["extra"]["guesthouse"] = null;
  if (priv) {
    try {
      const d = await loadGuesthouse(cid, company.taxProfile);
      const start = accommodationStart(d.days);
      const k = kpis(sumRange(d.days, ms, t), availableDays(ms, t, start, d.asOf), d.include);
      const next = d.stays.filter((s) => s.from >= t).sort((a, b) => a.from.localeCompare(b.from))[0];
      guesthouse = { occupancy: k.occupancy, nextStay: next?.from ?? null, nights: k.nights };
    } catch {
      guesthouse = null;
    }
  }

  // --- Fejléc mondat -----------------------------------------------------
  const red = todos.filter((x) => x.level === "red").length;
  const open = todos.filter((x) => x.level !== "green").length;
  const parts: string[] = [];
  // jelzői alak: „két dolog”, nem „kettő dolog”
  const cnt = (n: number) => (n <= 10 ? numberToHungarian(n).replace(/kettő$/, "két") : String(n));
  if (cars) {
    const n = cars.soldDay.length;
    if (n) parts.push(`Tegnap ${n === 1 ? "eladtunk egy autót" : `${cnt(n)} autót adtunk el`}, ${eFt(sum(cars.soldDay.map((s) => s.f2)))} nettó fedezettel.`);
    else parts.push(cars.daysSinceSale != null ? `Tegnap nem volt eladás, a legutóbbi ${cars.daysSinceSale} napja volt.` : "Tegnap nem volt eladás.");
  } else if (guesthouse) {
    parts.push(`Ebben a hónapban eddig ${guesthouse.nights} vendégéjszaka.`);
  }
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  parts.push(open ? `${cap(cnt(open))} dolog vár rád${red ? `, ${red === open ? (open === 1 ? "és sürgős" : "mind sürgős") : red === 1 ? "az egyik sürgős" : `ebből ${cnt(red)} sürgős`}` : ""}.` : "Minden rendben, nincs teendő.");

  return {
    companyId: cid,
    name: company.name,
    private: priv,
    date: t,
    day,
    headline: parts.join(" "),
    kpi: {
      cash: cashTotal,
      cashHuf: cash.find((c) => c.key === "cashHuf")?.huf ?? 0,
      // a pénztár mai árfolyamon (összes − bank) mínusz a forintpénztár = az EUR-pénztár forintértéke
      cashEur: liquidity - bank - (cash.find((c) => c.key === "cashHuf")?.huf ?? 0),
      cashEurFx: cash.find((c) => c.key === "cashEur")?.fx ?? 0,
      liquidity,
      revenueDay: revenueOf(tbDay),
      revenue30: revenueOf(tb30),
      bank,
      stock: cars ? cars.lanes.red.count + cars.lanes.yellow.count + cars.lanes.green.count : null,
      lateReceivable: sum(recvLate.map(toHuf)),
      lateReceivableCount: recvLate.length,
      latePayable: sum(payLate.map(toHuf)),
      latePayableCount: payLate.length,
    },
    stockValue,
    results: {
      month: resultOf(tbMtd),
      quarter: resultOf(tbQtd),
      // naptári üzleti évnél a Forecast „tény” része, hogy a kettő garantáltan egyezzen
      year: yearFc && company.fiscalYearStartMonth === 1 ? yearFc.actual : resultOf(tbYtd),
      yearForecast: yearFc?.preTax ?? null,
      yearForecastAfterTax: yearFc?.afterTax ?? null,
      forecastPartial: yearFc?.partial ?? false,
      yearBreakdown: yearFc ? { actual: yearFc.actual, plan: yearFc.plan, hipa: yearFc.hipa, tao: yearFc.tao } : null,
    },
    deadlines: { vat: vatDeadline, payroll: payrollDeadline },
    todos,
    cars,
    finance: {
      entries: entryRows,
      entryCount: entryRows.length,
      mtdResult: resultOf(tbMtd),
      prevMtdResult: resultOf(tbPrev),
      vatBalance: vat.balance,
      cashIn30,
    },
    extra: {
      mtdRevenue: revenueOf(tbMtd),
      ytdResult: resultOf(tbYtd),
      taxLiability,
      payablesDue14,
      memberLoans: memberLoansBal,
      cashSeries,
      guesthouse,
    },
  };
}

export type HoldingSnapshot = {
  date: string;
  day: string;
  companies: CompanySnapshot[];
  totals: { cash: number; revenueDay: number; mtdResult: number; prevMtdResult: number; ytdResult: number; capital: number; stock: number; obligations14: number; cover: number | null; memberLoans: number };
  cashSeries: number[];
  lanes: Record<KmStatus, { count: number; capital: number; holding: number }>;
  bestSale: { company: string; title: string; f2: number } | null;
  headline: string;
};

/** Az összes cég egyben (a holding tulajdonosainak). */
export async function holdingSnapshot(t = today(), cache = new Map<number, CompanySnapshot>()): Promise<HoldingSnapshot> {
  // v6.0.0 – csak az üzemeltető (holding) ügyfélfiókjának aktív cégei; archivált és más ügyfél cége nem kerül bele
  const list = await db.select({ id: schema.companies.id }).from(schema.companies).where(holdingCompanies()).orderBy(schema.companies.name);
  const companies: CompanySnapshot[] = [];
  for (const c of list) companies.push(cache.get(c.id) ?? (await companySnapshot(c.id, t)));
  const S = (f: (c: CompanySnapshot) => number) => sum(companies.map(f));
  const len = Math.max(0, ...companies.map((c) => c.extra.cashSeries.length));
  const cashSeries = Array.from({ length: len }, (_, i) => S((c) => c.extra.cashSeries[c.extra.cashSeries.length - len + i] ?? 0));
  const lane = (k: KmStatus) => ({ count: S((c) => c.cars?.lanes[k].count ?? 0), capital: S((c) => c.cars?.lanes[k].capital ?? 0), holding: S((c) => c.cars?.lanes[k].holding ?? 0) });

  // a hónap legjobb eladása (nettó fedezet)
  let bestSale: HoldingSnapshot["bestSale"] = null;
  for (const c of companies) {
    if (c.private) continue;
    const sold = soldView(await loadSoldCars(c.companyId, monthStart(t), t));
    for (const x of sold.rows) if (!bestSale || x.r.f2 > bestSale.f2) bestSale = { company: c.name, title: x.title, f2: x.r.f2 };
  }
  const cash = S((c) => c.kpi.cash);
  const obligations14 = S((c) => c.extra.taxLiability + c.extra.payablesDue14);
  const totals = {
    cash,
    revenueDay: S((c) => c.kpi.revenueDay),
    mtdResult: S((c) => c.finance.mtdResult),
    prevMtdResult: S((c) => c.finance.prevMtdResult),
    ytdResult: S((c) => c.extra.ytdResult),
    capital: S((c) => c.cars?.capital ?? 0),
    stock: S((c) => c.kpi.stock ?? 0),
    obligations14,
    cover: obligations14 > 0.5 ? cash / obligations14 : null,
    memberLoans: S((c) => c.extra.memberLoans),
  };
  const red = S((c) => c.todos.filter((x) => x.level === "red").length);
  const open = S((c) => c.todos.filter((x) => x.level !== "green").length);
  const cnt = (n: number) => (n <= 10 ? numberToHungarian(n).replace(/kettő$/, "két") : String(n));
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const todoTxt = open ? `${cap(cnt(open))} dolog vár rád${red ? (red === open ? (open === 1 ? ", és sürgős" : ", mind sürgős") : red === 1 ? ", az egyik sürgős" : `, ebből ${cnt(red)} sürgős`) : ""}.` : "Minden rendben, nincs teendő.";
  const headline = `A cégcsoportnak ${money(S((c) => c.kpi.liquidity))} pénze van, ebben a hónapban eddig ${money(totals.mtdResult, true)} az eredmény. ${todoTxt}`;
  return { date: t, day: addDaysIso(t, -1), companies, totals, cashSeries, lanes: { red: lane("red"), yellow: lane("yellow"), green: lane("green") }, bestSale, headline };
}

/** v6.0.0 – A holding-összefoglaló cégei: az üzemeltető ügyfélfiókjának nem archivált cégei. */
export function holdingCompanies() {
  return and(
    isNull(schema.companies.archivedAt),
    inArray(schema.companies.organizationId, db.select({ o: schema.users.organizationId }).from(schema.users).where(eq(schema.users.isPlatformAdmin, true))),
  );
}
