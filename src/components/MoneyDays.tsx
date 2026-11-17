"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

export type MoneyDayLine = {
  id: number; entryId: number; number: string; text: string; partner: string | null;
  debit: number; credit: number; balance: number; amountFx: number | null;
};
export type MoneyDay = { date: string; open: number; inflow: number; outflow: number; close: number; lines: MoneyDayLine[] };

const DOW = ["vas.", "hét.", "kedd", "szer.", "csüt.", "pén.", "szo."];
const dow = (d: string) => DOW[new Date(d + "T00:00:00Z").getUTCDay()];
const Amt = ({ v }: { v: number }) => (Math.abs(v) < 0.5 ? <span className="muted">–</span> : <>{fmtHuf(v)}</>);

/** Napi pénztár- / bankjelentés: naponta egy összesítő sor, kattintásra lenyíló tételekkel. Nyomtatásban minden tétel látszik. */
const HU_MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const WD = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
const short = (v: number) => {
  const a = Math.abs(v);
  const t = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",")}\u00a0M` : a >= 1e3 ? `${Math.round(a / 1e3)}\u00a0e` : `${Math.round(a)}`;
  return `${v > 0 ? "+" : "−"}${t}`;
};

/** Havi naptár: minden nap színe a nettó pénzmozgás (kék be, narancs ki; sötétebb = nagyobb összeg). */
function MoneyCalendar({ days, from, to, open, onPick }: { days: MoneyDay[]; from: string; to: string; open: Set<string>; onPick: (d: string) => void }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const maxNet = Math.max(1, ...days.map((d) => Math.abs(d.inflow - d.outflow)));
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    if (months.length > 24) break;
  }
  return (
    <div className="money-cal">
      {months.map((m) => {
        const [y, mo] = m.split("-").map(Number);
        const first = new Date(Date.UTC(y, mo - 1, 1));
        const lead = (first.getUTCDay() + 6) % 7;
        const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)];
        return (
          <section key={m} className="mc-month" aria-label={`${y}. ${HU_MONTH[mo - 1]}`}>
            <h3>{y}. {HU_MONTH[mo - 1]}</h3>
            <div className="mc-grid">
              {WD.map((w) => <span key={w} className="mc-wd">{w}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={`x${i}`} />;
                const day = byDate.get(d);
                const inRange = d >= from && d <= to;
                if (!day) return <span key={d} className={`mc-cell empty${inRange ? "" : " out"}`}><b>{Number(d.slice(8))}</b></span>;
                const net = day.inflow - day.outflow;
                const t = Math.abs(net) / maxNet;
                const light = Math.round(93 - t * 50);
                const bg = net >= 0 ? `hsl(221 71% ${light}%)` : `hsl(21 75% ${light}%)`;
                return (
                  <button key={d} type="button" className={`mc-cell${open.has(d) ? " on" : ""}`} style={{ background: bg, color: light < 62 ? "#fff" : "#17202b" }}
                    onClick={() => onPick(d)} title={`${fmtDate(d)}: be ${fmtHuf(day.inflow)} · ki ${fmtHuf(day.outflow)} · záró ${fmtHuf(day.close)} Ft`}
                    aria-label={`${fmtDate(d)}, nettó ${fmtHuf(net)} Ft, ${day.lines.length} tétel`} aria-pressed={open.has(d)}>
                    <b>{Number(d.slice(8))}</b>
                    <span>{Math.abs(net) < 0.5 ? "±0" : short(net)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="mc-legend muted"><i style={{ background: "hsl(221 71% 45%)" }} /> nettó befolyás <i style={{ background: "hsl(21 75% 45%)" }} /> nettó kiáramlás · sötétebb = nagyobb összeg</div>
    </div>
  );
}

export function MoneyDays({ days, cid, currency, initialOpen, from, to }: { days: MoneyDay[]; cid: number; currency: string; initialOpen?: string | null; from: string; to: string }) {
  const fx = currency !== "HUF";
  const [sel, setSel] = useState<string | null>(() => (initialOpen && days.some((d) => d.date === initialOpen) ? initialOpen : days.length ? days[days.length - 1].date : null));
  const day = days.find((d) => d.date === sel) ?? null;
  return (
    <>
      <div className="md-layout no-print">
        <MoneyCalendar days={days} from={from} to={to} open={new Set(sel ? [sel] : [])} onPick={setSel} />
        <aside className="md-panel card" aria-live="polite">
          {!day && <p className="muted">{days.length ? "Kattints egy színes napra a naptárban." : "Nincs mozgás az időszakban."}</p>}
          {day && (
            <>
              <div className="md-panel-head">
                <h2>{fmtDate(day.date)} <span className="muted">{dow(day.date)}</span></h2>
                <span className="muted">{day.lines.length} tétel</span>
              </div>
              <dl className="md-sum">
                <div><dt>Nyitó</dt><dd>{fmtHuf(day.open)}</dd></div>
                <div><dt>Bevétel</dt><dd className="md-in"><Amt v={day.inflow} /></dd></div>
                <div><dt>Kiadás</dt><dd className="md-out"><Amt v={day.outflow} /></dd></div>
                <div><dt>Záró</dt><dd className={`strong${day.close < 0 ? " neg" : ""}`}>{fmtHuf(day.close)}</dd></div>
              </dl>
              <ul className="md-items">
                {day.lines.map((l) => (
                  <li key={l.id}>
                    <div className="md-item-main">
                      <span className="md-item-text">{l.text}{l.partner ? <span className="muted"> · {l.partner}</span> : null}</span>
                      <Link className="mono muted md-item-no" href={`/c/${cid}/journal/${l.entryId}`}>{l.number}</Link>
                    </div>
                    <div className="md-item-amt">
                      <strong className={l.debit ? "md-in" : "md-out"}>{l.debit ? `+${fmtHuf(l.debit)}` : `−${fmtHuf(l.credit)}`}</strong>
                      {fx && l.amountFx ? <span className="muted">{fmtMoney(l.amountFx, currency)}</span> : null}
                      <span className="muted">egyenleg {fmtHuf(l.balance)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      {/* Nyomtatásban a teljes napi jelentés */}
      <table className="money-days print-only">
        <thead>
          <tr><th>Nap / tétel</th><th className="num">Bevétel</th><th className="num">Kiadás</th><th className="num">Egyenleg</th></tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <Fragment key={d.date}>
              <tr className="md-day"><td><strong>{fmtDate(d.date)}</strong> {dow(d.date)} · nyitó {fmtHuf(d.open)}</td><td className="num"><Amt v={d.inflow} /></td><td className="num"><Amt v={d.outflow} /></td><td className="num strong">{fmtHuf(d.close)}</td></tr>
              {d.lines.map((l) => (
                <tr key={l.id} className="md-item"><td className="md-text">{l.number} {l.text}{l.partner ? ` · ${l.partner}` : ""}{fx && l.amountFx ? ` · ${fmtMoney(l.amountFx, currency)}` : ""}</td><td className="num">{l.debit ? fmtHuf(l.debit) : ""}</td><td className="num">{l.credit ? fmtHuf(l.credit) : ""}</td><td className="num">{fmtHuf(l.balance)}</td></tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
