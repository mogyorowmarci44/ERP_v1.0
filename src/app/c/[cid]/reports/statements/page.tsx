import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { dailyRows } from "@/lib/reports";
import { buckets, buildPnl, buildCashFlow, buildBalanceSheet, GRAN_LABEL, MAX_COLUMNS, type Granularity, type Statement } from "@/lib/statements";
import { fmtHuf } from "@/lib/money";
import { isDate, today, fmtDate } from "@/lib/dates";
import { addDays } from "@/lib/fx";
import { Sankey, sankeyModel } from "@/components/Sankey";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";

const TYPES = { pnl: "Eredménykimutatás (P&L)", sankey: "Eredmény-Sankey", cf: "Cash-flow", bs: "Mérleg" } as const;
type T = keyof typeof TYPES;

/** Alapértelmezett időtartam a bontáshoz. */
function defaultRange(gran: Granularity, t: string): [string, string] {
  const y = t.slice(0, 4);
  if (gran === "day") return [addDays(t, -13), t];
  if (gran === "week") return [addDays(t, -7 * 11), t];
  if (gran === "month") return [`${y}-01-01`, t];
  return [`${y}-01-01`, `${y}-12-31`];
}

function Amount({ v }: { v: number }) {
  if (Math.abs(v) < 0.5) return <span className="muted">–</span>;
  return <span className={v < 0 ? "neg" : undefined}>{fmtHuf(v)}</span>;
}

function StatementTable({ s }: { s: Statement }) {
  return (
    <div className="table-wrap">
      <table className="statement">
        <thead>
          <tr>
            <th>{s.title} (Ft)</th>
            {s.columnLabels.map((l, i) => <th key={i} className="num">{l}</th>)}
            {s.hasTotal && <th className="num col-total">Összesen</th>}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key} className={`k-${r.kind}`}>
              <td className={r.indent ? `indent-${r.indent}` : undefined}>{r.label}</td>
              {r.values.map((v, i) => <td key={i} className="num"><Amount v={v} /></td>)}
              {s.hasTotal && <td className="num col-total">{r.total === undefined ? "" : <Amount v={r.total} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function StatementsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  const type: T = sp.type === "cf" || sp.type === "bs" || sp.type === "sankey" ? sp.type : "pnl";
  const gran: Granularity = (["day", "week", "month", "quarter"] as const).find((g) => g === sp.gran) ?? "month";
  const t = today();
  const [dFrom, dTo] = defaultRange(gran, t);
  const from = isDate(sp.from) ? sp.from : dFrom;
  const to = isDate(sp.to) ? sp.to : dTo;
  const cols = buckets(from, to, gran);
  const tooMany = cols.length > MAX_COLUMNS;

  let statement: Statement | null = null;
  if (!tooMany && cols.length) {
    const rows = await dailyRows(cid, to);
    statement =
      type === "pnl" || type === "sankey" ? buildPnl(rows, cols) : type === "cf" ? buildCashFlow(rows, cols) : buildBalanceSheet(rows, cols, company.fiscalYearStartMonth, from);
  }
  // Sankey: egy kiválasztott időszak vagy a teljes tartomány
  const period = sp.period && cols.some((c) => c.key === sp.period) ? sp.period : "total";
  const periodIdx = period === "total" ? "total" : cols.findIndex((c) => c.key === period);

  const base = `/c/${cid}/reports/statements`;
  // Típus- vagy bontásváltáskor az alapértelmezett időtartam (kivéve, ha a felhasználó állította)
  const link = (o: Partial<{ type: T; gran: Granularity }>) => {
    const q = new URLSearchParams({ type: o.type ?? type, gran: o.gran ?? gran });
    if (!o.gran && sp.from) q.set("from", from);
    if (!o.gran && sp.to) q.set("to", to);
    if (!o.gran && sp.period) q.set("period", sp.period);
    return `${base}?${q}`;
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Kimutatások</h1>
          <span className="muted">{company.name}, {fmtDate(from)} – {fmtDate(to)}</span>
        </div>
        <div className="segmented no-print" role="tablist" aria-label="Bontás">
          {(Object.keys(GRAN_LABEL) as Granularity[]).map((g) => (
            <Link key={g} href={link({ gran: g })} className={g === gran ? "on" : undefined} role="tab" aria-selected={g === gran}>{GRAN_LABEL[g]}</Link>
          ))}
        </div>
      </div>

      <nav className="tabs no-print" aria-label="Kimutatás típusa">
        {(Object.keys(TYPES) as T[]).map((k) => (
          <Link key={k} href={link({ type: k })} className={k === type ? "on" : undefined}>{TYPES[k]}</Link>
        ))}
      </nav>

      <form className="row no-print" style={{ marginBottom: 16 }}>
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="gran" value={gran} />
        <label>Kezdő dátum<input type="date" name="from" defaultValue={from} /></label>
        <label>Záró dátum<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Frissítés</button>
      </form>

      {tooMany && <div className="flash error">Túl sok oszlop ({cols.length}). {GRAN_LABEL[gran]} bontásnál legfeljebb {MAX_COLUMNS} időszak fér el – szűkítsd a dátumokat vagy válassz nagyobb bontást.</div>}
      {statement && !statement.checkOk && (
        <div className="flash error">A kimutatás nem egyezik a főkönyvvel – ellenőrizd a számlatükör besorolását (lásd a kiemelt eltérés sort).</div>
      )}
      {statement && type === "sankey" && (
        <>
          <form className="row no-print" style={{ marginBottom: 12 }}>
            <input type="hidden" name="type" value="sankey" />
            <input type="hidden" name="gran" value={gran} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <AutoSubmitSelect
              name="period"
              label="Megjelenített időszak"
              defaultValue={period}
              options={[{ value: "total", label: `Teljes időszak (${fmtDate(from)} – ${fmtDate(to)})` }, ...cols.map((c) => ({ value: c.key, label: c.label }))]}
            />
            <noscript><button style={{ alignSelf: "end" }}>Mutasd</button></noscript>
          </form>
          {(() => {
            const model = sankeyModel(statement, periodIdx as number | "total");
            const label = period === "total" ? `${fmtDate(from)} – ${fmtDate(to)}` : cols[periodIdx as number].label;
            return (
              <>
                <Sankey model={model} title={`Bevételek felhasználása, ${label}`} />
                {model.skipped.length > 0 && (
                  <p className="muted">Negatív egyenlegű sorok, amik a diagramon nem jelennek meg (a táblázatban igen): {model.skipped.join("; ")}.</p>
                )}
              </>
            );
          })()}
        </>
      )}
      {statement && type !== "sankey" && <StatementTable s={statement} />}

      <p className="muted" style={{ marginTop: 14 }}>
        {type === "sankey" && "A szalagok szélessége arányos az összeggel. Bal oldalon a bevételek, jobbra haladva a ráfordítások és az eredmény. A százalékok az árbevételhez viszonyítanak. A szalag fölé húzva az egérrel megjelenik a pontos összeg."}
        {type === "pnl" && "Összköltség eljárással, az Szt. 1. sz. melléklete szerinti szerkezetben. A költségek az 5. számlaosztályból, az ELÁBÉ a 81-ből számolódik."}
        {type === "bs" && "Az időszakok végi állapot. Az évzárás előtt a tárgyévi eredmény az Adózott eredmény, a korábbi évek le nem zárt eredménye az Eredménytartalék sorban jelenik meg. Az ÁFA-számlák nettó egyenlege követelésként vagy kötelezettségként szerepel."}
        {type === "cf" && "Indirekt módszer: az adózás előtti eredményből indul, a nem pénzmozgással járó tételek és a forgótőke változása után a befektetési és finanszírozási mozgások jönnek. A IV. sor egyezik a 38-as számlák változásával."}
      </p>
    </>
  );
}
