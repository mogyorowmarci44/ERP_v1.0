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
    <div className="money-cal no-print">
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
      <div className="mc-legend muted"><i style={{ background: "hsl(221 71% 45%)" }} /> nettó befolyás <i style={{ background: "hsl(21 75% 45%)" }} /> nettó kiáramlás · sötétebb = nagyobb összeg · kattints egy napra</div>
    </div>
  );
}

export function MoneyDays({ days, cid, currency, initialOpen, from, to }: { days: MoneyDay[]; cid: number; currency: string; initialOpen?: string | null; from: string; to: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []));
  const fx = currency !== "HUF";
  const cols = fx ? 8 : 7;
  const toggle = (d: string) => setOpen((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const allOpen = days.length > 0 && days.every((d) => open.has(d.date));
  const pick = (d: string) => {
    setOpen((s) => new Set(s).add(d));
    requestAnimationFrame(() => document.getElementById(`md-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <>
      <MoneyCalendar days={days} from={from} to={to} open={open} onPick={pick} />
      <div className="row no-print" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <span className="muted" style={{ marginRight: "auto" }}>{days.length} nap mozgással · kattints egy napra a tételekért</span>
        <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(days.map((d) => d.date)))}>{allOpen ? "Mind becsuk" : "Mind kinyit"}</button>
      </div>
      <div className="table-wrap">
        <table className="money-days">
          <thead>
            <tr>
              <th className="md-chev" aria-hidden="true"></th>
              <th>Nap</th>
              <th className="num">Nyitó</th>
              <th className="num">Bevétel</th>
              <th className="num">Kiadás</th>
              <th className="num">Záró</th>
              {fx && <th className="num">{currency}</th>}
              <th className="num">Tétel</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const isOpen = open.has(d.date);
              return (
                <Fragment key={d.date}>
                  <tr id={`md-${d.date}`} className={`md-day${isOpen ? " open" : ""}`} onClick={() => toggle(d.date)}>
                    <td className="md-chev">
                      <button type="button" className="md-toggle" aria-expanded={isOpen} aria-label={`${fmtDate(d.date)} tételei`} onClick={(e) => { e.stopPropagation(); toggle(d.date); }}>
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td><strong>{fmtDate(d.date)}</strong> <span className="muted">{dow(d.date)}</span></td>
                    <td className="num muted"><Amt v={d.open} /></td>
                    <td className="num md-in"><Amt v={d.inflow} /></td>
                    <td className="num md-out"><Amt v={d.outflow} /></td>
                    <td className={`num strong${d.close < 0 ? " neg" : ""}`}>{fmtHuf(d.close)}</td>
                    {fx && <td></td>}
                    <td className="num muted">{d.lines.length}</td>
                  </tr>
                  {d.lines.map((l) => (
                    <tr key={l.id} className={`md-item${isOpen ? "" : " collapsed"}`}>
                      <td></td>
                      <td className="md-text" colSpan={2}>
                        <Link className="mono" href={`/c/${cid}/journal/${l.entryId}`}>{l.number}</Link> {l.text}
                        {l.partner ? <span className="muted"> · {l.partner}</span> : null}
                      </td>
                      <td className="num md-in">{l.debit ? fmtHuf(l.debit) : ""}</td>
                      <td className="num md-out">{l.credit ? fmtHuf(l.credit) : ""}</td>
                      <td className={`num muted${l.balance < 0 ? " neg" : ""}`}>{fmtHuf(l.balance)}</td>
                      {fx && <td className="num">{l.amountFx ? fmtMoney(l.amountFx, currency) : ""}</td>}
                      <td></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {days.length === 0 && <tr><td colSpan={cols} className="muted">Nincs mozgás az időszakban.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
