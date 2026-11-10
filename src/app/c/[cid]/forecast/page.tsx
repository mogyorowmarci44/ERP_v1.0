import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { loadForecastInput } from "@/lib/forecast-data";
import { runForecast, SCENARIOS, SCENARIO_LABEL, type Scenario, type FcMonth, type FcResult } from "@/lib/forecast";
import { ForecastTabs, ScenarioSwitch, ScenarioChart } from "@/components/Forecast";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

const MONTHS_HU = ["jan", "febr", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
const mLabel = (m: string) => `${m.slice(0, 4)}. ${MONTHS_HU[Number(m.slice(5)) - 1]}`;

function Amount({ v, plain }: { v: number; plain?: boolean }) {
  if (Math.abs(v) < 0.5) return <span className="muted">–</span>;
  return <span className={v < 0 && !plain ? "neg" : undefined}>{fmtHuf(v)}</span>;
}

type Row = { label: string; kind?: "head" | "subtotal" | "total"; get?: (m: FcMonth) => number; total?: "sum" | "last" | "min" | "none"; indent?: boolean; count?: boolean };
const ROWS: Row[] = [
  { label: "Eredmény", kind: "head" },
  { label: "Eladott autók (db)", get: (m) => m.carsSold, total: "sum", count: true },
  { label: "Bruttó eladási ár", get: (m) => m.salesGross, total: "sum", indent: true },
  { label: "Nettó árbevétel", get: (m) => m.revenue, total: "sum" },
  { label: "ELÁBÉ (könyv szerinti érték)", get: (m) => -m.cogs, total: "sum" },
  { label: "Bruttó fedezet", kind: "subtotal", get: (m) => m.grossMargin, total: "sum" },
  { label: "Autós költségek (azonnal elszámolt)", get: (m) => -m.vehicleCosts, total: "sum" },
  { label: "Ismétlődő és egyszeri költségek", get: (m) => -m.fixedCosts, total: "sum" },
  { label: "Adózás előtti eredmény", kind: "total", get: (m) => m.preTax, total: "sum" },
  { label: "ÁFA", kind: "head" },
  { label: "Különbözeti ÁFA (fizetendő)", get: (m) => m.marginVat, total: "sum" },
  { label: "Levonható ÁFA", get: (m) => -m.inputVat, total: "sum" },
  { label: "ÁFA egyenleg", kind: "subtotal", get: (m) => m.vatBalance, total: "sum" },
  { label: "ÁFA befizetés", get: (m) => -m.vatPaid, total: "sum" },
  { label: "Pénzáramlás", kind: "head" },
  { label: "Befolyó pénz", get: (m) => m.cashIn, total: "sum" },
  { label: "Kifizetések", get: (m) => -m.cashOut, total: "sum" },
  { label: "ebből TAO + HIPA", get: (m) => -m.taxPaid, total: "sum", indent: true },
  { label: "Záró pénztár", kind: "subtotal", get: (m) => m.endCash, total: "last" },
  { label: "Záró bank", kind: "subtotal", get: (m) => m.endBank, total: "last" },
  { label: "Legalacsonyabb pénztár a hónapban", get: (m) => m.minCash, total: "min", indent: true },
  { label: "Legalacsonyabb bank a hónapban", get: (m) => m.minBank, total: "min", indent: true },
];

function MonthTable({ r }: { r: FcResult }) {
  const tot = (row: Row) => {
    const vals = r.months.map(row.get!);
    if (row.total === "sum") return vals.reduce((a, b) => a + b, 0);
    if (row.total === "last") return vals[vals.length - 1];
    if (row.total === "min") return Math.min(...vals);
    return 0;
  };
  return (
    <div className="table-wrap">
      <table className="statement">
        <thead>
          <tr><th>Havi terv – {SCENARIO_LABEL[r.scenario].toLowerCase()} forgatókönyv (Ft)</th>{r.months.map((m) => <th key={m.month} className="num">{mLabel(m.month)}</th>)}<th className="num col-total">Összesen</th></tr>
        </thead>
        <tbody>
          {ROWS.map((row) =>
            row.kind === "head" ? (
              <tr key={row.label} className="k-head"><td>{row.label}</td>{r.months.map((m) => <td key={m.month} />)}<td className="col-total" /></tr>
            ) : (
              <tr key={row.label} className={row.kind ? `k-${row.kind}` : undefined}>
                <td className={row.indent ? "indent-1" : undefined}>{row.label}</td>
                {r.months.map((m) => <td key={m.month} className="num">{row.count ? (row.get!(m) || <span className="muted">–</span>) : <Amount v={row.get!(m)} />}</td>)}
                <td className="num col-total">{row.count ? tot(row) : <Amount v={tot(row)} />}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function ForecastPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const view = sp.view === "compare" ? "compare" : "single";
  const sc: Scenario = (SCENARIOS as string[]).includes(sp.sc) ? (sp.sc as Scenario) : "base";
  const input = await loadForecastInput(cid);
  const results = Object.fromEntries(SCENARIOS.map((s) => [s, runForecast(input, s)])) as Record<Scenario, FcResult>;
  const r = results[sc];
  const link = (q: Record<string, string>) => `/c/${cid}/forecast?${new URLSearchParams({ sc, view, ...q })}`;
  const curYear = r.years[0];
  const o = input.opening;

  return (
    <div className="viz-sc">
      <h1>Tervezés</h1>
      <ForecastTabs cid={cid} active="" />
      <Flash error={sp.error} ok={sp.ok} />

      <div className="fc-head">
        <div className="row">
          <ScenarioSwitch href={(s) => link({ sc: s, view: "single" })} active={view === "compare" ? "compare" : sc} />
          <div className="segmented no-print">
            <Link href={link({ view: "single" })} className={view === "single" ? "on" : undefined}>Havi bontás</Link>
            <Link href={link({ view: "compare" })} className={view === "compare" ? "on" : undefined}>Összehasonlítás</Link>
          </div>
        </div>
        <span className="muted">Kiinduló állapot: {fmtDate(o.asOf)} · pénztár {fmtHuf(o.cash)} Ft · bank {fmtHuf(o.bank)} Ft · nyitott ÁFA {fmtHuf(o.vatPayable)} Ft · nyitott számlák {fmtHuf((o.openItems ?? []).reduce((a, x) => a + x.amount, 0))} Ft (esedékességkor)</span>
      </div>

      {input.plans.length === 0 && input.items.length === 0 && (
        <div className="card fc-warn" style={{ marginBottom: 14 }}>
          Még nincs terv. Kezdd a <Link href={`/c/${cid}/forecast/stock`}>Készlet és eladások</Link> fülön (egy gombbal kitölthető javaslat), majd a <Link href={`/c/${cid}/forecast/costs`}>Költségek</Link> fülön vedd fel az ismétlődő tételeket.
        </div>
      )}

      {view === "single" && <>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="card stat primary"><div className="label">Adózás előtti eredmény ({r.months.length} hó)</div><div className="value">{fmtHuf(r.totals.preTax)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Eladott autók · bruttó fedezet</div><div className="value">{r.totals.carsSold} db · {fmtHuf(r.totals.grossMargin)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Különbözeti ÁFA a tervben</div><div className="value">{fmtHuf(r.totals.marginVat)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Legalacsonyabb pénzkészlet</div><div className={`value${r.totals.minTotal < 0 ? " neg" : ""}`}>{fmtHuf(r.totals.minTotal)}<small>Ft · {fmtDate(r.totals.minTotalDate)}</small></div></div>
      </div>

      {curYear && (
        <p className="muted">
          {curYear.year}. üzleti év becslés: tény {fmtHuf(curYear.actualPreTax)} Ft + terv {fmtHuf(curYear.forecastPreTax)} Ft − HIPA {fmtHuf(curYear.hipa)} Ft = adózás előtti eredmény <strong>{fmtHuf(curYear.preTax)} Ft</strong>,
          társasági adó {fmtHuf(curYear.tao)} Ft (befizetés {fmtDate(curYear.payDate)}).
          {r.years.slice(1).map((y) => ` ${y.year}: ${fmtHuf(y.preTax)} Ft${y.partial ? " (részleges év)" : ""}.`)}
        </p>
      )}
      </>}

      {view === "compare" && SCENARIOS.some((x) => results[x].warnings.length) && (
        <div className="card fc-warn" style={{ margin: "12px 0" }}>
          <strong>Figyelmeztetések</strong>
          <ul>{SCENARIOS.flatMap((x) => results[x].warnings.map((w, i) => <li key={x + i}><span className={`sc-${x}`}><span className="sc-dot" aria-hidden />{SCENARIO_LABEL[x]}:</span> {w}</li>))}</ul>
        </div>
      )}
      {view === "single" && r.warnings.length > 0 && (
        <div className="card fc-warn" style={{ margin: "12px 0" }}>
          <strong>Figyelmeztetések</strong>
          <ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {input.unplanned.length > 0 && (
        <p className="muted">Terv nélküli készletautó (nem számol vele): {input.unplanned.join(", ")} – <Link href={`/c/${cid}/forecast/stock`}>terv megadása</Link>.</p>
      )}

      {view === "compare" ? (
        <>
          <div className="card" style={{ margin: "12px 0" }}>
            <ScenarioChart series={SCENARIOS.map((s) => ({ scenario: s, points: results[s].months.map((m) => ({ label: mLabel(m.month), value: m.endCash + m.endBank, min: Math.min(m.minCash, m.minBank) })) }))} />
          </div>
          <div className="table-wrap">
            <table className="statement">
              <thead><tr><th>Forgatókönyvek (Ft)</th>{SCENARIOS.map((s) => <th key={s} className={`num sc-${s}`}><span className="sc-dot" aria-hidden />{SCENARIO_LABEL[s]}</th>)}</tr></thead>
              <tbody>
                {([
                  ["Eladott autók (db)", (x: FcResult) => x.totals.carsSold, true],
                  ["Nettó árbevétel", (x: FcResult) => x.totals.revenue],
                  ["Bruttó fedezet", (x: FcResult) => x.totals.grossMargin],
                  ["Adózás előtti eredmény (horizont)", (x: FcResult) => x.totals.preTax],
                  ["Különbözeti ÁFA", (x: FcResult) => x.totals.marginVat],
                  [`${curYear?.year ?? ""}. évi eredmény (tény + terv)`, (x: FcResult) => x.years[0]?.preTax ?? 0],
                  [`${curYear?.year ?? ""}. évi TAO + HIPA`, (x: FcResult) => (x.years[0]?.tao ?? 0) + (x.years[0]?.hipa ?? 0)],
                  ["Záró pénztár + bank", (x: FcResult) => x.totals.endCash + x.totals.endBank],
                  ["Legalacsonyabb pénzkészlet", (x: FcResult) => x.totals.minTotal],
                ] as Array<[string, (x: FcResult) => number, boolean?]>).map(([label, f, count]) => (
                  <tr key={label}><td>{label}</td>{SCENARIOS.map((s) => <td key={s} className="num">{count ? f(results[s]) : <Amount v={f(results[s])} />}</td>)}</tr>
                ))}
                <tr><td>A legalacsonyabb pont dátuma</td>{SCENARIOS.map((s) => <td key={s} className="num">{fmtDate(results[s].totals.minTotalDate)}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <MonthTable r={r} />
          <h2>Eladások a tervben</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Gépkocsi</th><th>Eladás</th><th className="num">Bruttó ár</th><th className="num">ÁFA-alap (beszerzés)</th><th className="num">Különbözeti ÁFA</th><th className="num">Nettó árbevétel</th><th className="num">ELÁBÉ</th><th className="num">Fedezet</th></tr></thead>
              <tbody>
                {[...r.sales].sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)).map((s) => (
                  <tr key={s.planId} className={s.inHorizon ? undefined : "muted"}>
                    <td>{s.label}</td>
                    <td>{fmtDate(s.saleDate)}{s.shifted && <span className="badge soon" style={{ marginLeft: 6 }}>csúszik</span>}{!s.inHorizon && <span className="badge" style={{ marginLeft: 6 }}>horizonton túl</span>}</td>
                    <td className="num">{fmtHuf(s.salePrice)}</td>
                    <td className="num">{fmtHuf(s.marginBase)}</td>
                    <td className="num">{fmtHuf(s.marginVat)}</td>
                    <td className="num">{fmtHuf(s.netRevenue)}</td>
                    <td className="num">{fmtHuf(s.cogs)}</td>
                    <td className="num"><Amount v={s.grossMargin} /></td>
                  </tr>
                ))}
                {r.sales.length === 0 && <tr><td colSpan={8} className="muted">Nincs tervezett eladás.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ marginTop: 12 }}>
        A különbözeti ÁFA autónként számolódik: (bruttó eladási ár − beszerzési ár) × 27/127, negatív különbözetnél 0. Az ÁFA a bevallási időszak után ({o.vatPeriod === "monthly" ? "havi" : o.vatPeriod === "quarterly" ? "negyedéves" : "éves"}) esedékes; a negatív egyenleg továbbvihető.
        A TAO és a HIPA az üzleti év tény + terv eredményéből becsült (előlegek és adóalap-korrekciók nélkül), befizetés a következő év május 31-ig.
      </p>
    </div>
  );
}
