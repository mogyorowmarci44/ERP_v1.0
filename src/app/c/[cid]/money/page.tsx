import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { moneyMonitor } from "@/lib/money-monitor";
import { GRAN_LABEL, MAX_COLUMNS, type Granularity } from "@/lib/statements";
import { MiniLine } from "@/components/MiniLine";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, isDate, today } from "@/lib/dates";
import { addDays } from "@/lib/fx";

function defaultRange(gran: Granularity, t: string): [string, string] {
  if (gran === "day") return [addDays(t, -29), t];
  if (gran === "week") return [addDays(t, -7 * 15), t];
  if (gran === "month") return [`${Number(t.slice(0, 4)) - 1}${t.slice(4, 7)}-01`, t];
  return [`${Number(t.slice(0, 4)) - 1}-01-01`, t];
}

export default async function MoneyPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const gran: Granularity = (["day", "week", "month", "quarter"] as const).find((g) => g === sp.gran) ?? "week";
  const t = today();
  const [dFrom, dTo] = defaultRange(gran, t);
  const from = isDate(sp.from) ? sp.from : dFrom;
  const to = isDate(sp.to) ? sp.to : dTo;
  const m = await moneyMonitor(cid, from, to, gran);
  const tooMany = m.columns.length > MAX_COLUMNS;
  const negCash = m.accounts.filter((a) => a.negativeDays.length);
  // mozgás és egyenleg nélküli számlák külön, összevonva
  const active = m.accounts.filter((a) => Math.abs(a.balanceHuf) > 0.5 || a.series.some((s) => Math.abs(s.close) > 0.5 || s.inflow || s.outflow));
  const idle = m.accounts.filter((a) => !active.includes(a));
  const base = `/c/${cid}/money`;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Pénztár és bank</h1>
          <span className="muted">Összes pénzeszköz ma: <strong>{fmtHuf(m.total)} Ft</strong></span>
        </div>
        <div className="segmented no-print" role="tablist" aria-label="Bontás">
          {(Object.keys(GRAN_LABEL) as Granularity[]).map((g) => (
            <Link key={g} href={`${base}?gran=${g}`} className={g === gran ? "on" : undefined} role="tab" aria-selected={g === gran}>{GRAN_LABEL[g]}</Link>
          ))}
        </div>
      </div>
      <form className="row no-print" style={{ marginBottom: 16 }}>
        <input type="hidden" name="gran" value={gran} />
        <label>Kezdő dátum<input type="date" name="from" defaultValue={from} /></label>
        <label>Záró dátum<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Frissítés</button>
      </form>

      {negCash.map((a) => (
        <div key={a.id} className="flash error">
          {a.isCash ? "Negatív pénztáregyenleg" : "Negatív bankszámla-egyenleg"} – {a.code} {a.name}: {a.negativeDays.length} napon, először {fmtDate(a.negativeDays[0].date)} ({fmtHuf(a.negativeDays[0].balance)} Ft).
          {a.isCash ? " A pénztár nem lehet negatív – valószínűleg hiányzik egy befizetés vagy rossz a dátum." : ""}
        </div>
      ))}
      {tooMany && <div className="flash error">Túl sok időszak – szűkítsd a dátumokat vagy válassz nagyobb bontást.</div>}

      <div className="money-grid">
        {active.map((a) => (
          <div key={a.id} className="card money-card">
            <div className="head">
              <Link href={`${base}/${a.id}?from=${from}&to=${to}`}><strong>{a.code} {a.name}</strong></Link>
              <span className={`bal${a.balanceHuf < 0 ? " neg" : ""}`}>
                {a.currency !== "HUF" && a.balanceFx !== null ? fmtMoney(a.balanceFx, a.currency) : `${fmtHuf(a.balanceHuf)} Ft`}
              </span>
            </div>
            {a.currency !== "HUF" && (
              <div className="meta">
                <span>Könyv szerint: {fmtHuf(a.balanceHuf)} Ft{a.avgRate ? ` (átlag ${String(a.avgRate).replace(".", ",")} Ft/${a.currency})` : ""}</span>
                {a.mnbRate !== null ? (
                  <span>
                    MNB {fmtDate(a.mnbRateDate)}: {String(a.mnbRate).replace(".", ",")} → {fmtHuf(a.revaluedHuf)} Ft,{" "}
                    <span className={a.unrealized! < 0 ? "neg" : "pos"}>nem realizált {a.unrealized! >= 0 ? "nyereség" : "veszteség"} {fmtHuf(Math.abs(a.unrealized!))} Ft</span>
                  </span>
                ) : (
                  <span>MNB árfolyam most nem érhető el</span>
                )}
              </div>
            )}
            {!tooMany && (
              <MiniLine
                title={`${a.code} ${a.name}`}
                points={a.series.map((s) => ({ label: s.label, value: s.close, sub: `Be: ${fmtHuf(s.inflow)} Ft, ki: ${fmtHuf(s.outflow)} Ft` }))}
              />
            )}
          </div>
        ))}
      </div>

      {idle.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Mozgás nélküli pénzszámlák: {idle.map((a, i) => <span key={a.id}>{i ? ", " : ""}<Link href={`${base}/${a.id}`}>{a.code} {a.name}</Link></span>)}.
        </p>
      )}

      {!tooMany && active.length > 0 && (
        <>
          <h2>Időszak végi egyenlegek (Ft)</h2>
          <div className="table-wrap">
            <table className="statement">
              <thead>
                <tr><th>Számla</th>{m.columns.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`${base}/${a.id}?from=${from}&to=${to}`}>{a.code} {a.name}</Link></td>
                    {a.series.map((s) => <td key={s.start} className={`num${s.close < 0 ? " neg" : ""}`}>{fmtHuf(s.close)}</td>)}
                  </tr>
                ))}
                <tr className="k-total">
                  <td>Összesen</td>
                  {m.columns.map((c, i) => <td key={c.key} className="num">{fmtHuf(m.accounts.reduce((s, a) => s + a.series[i].close, 0))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ marginTop: 12 }}>
        Számlára kattintva napi pénztár- és bankjelentés nyílik (nyitó, bevételek, kiadások, záró). A devizás számlák nem realizált árfolyam-különbözete
        tájékoztató jellegű; könyvelni év végén, a fordulónapi értékelésnél kell.
      </p>
    </>
  );
}
