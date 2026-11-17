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
export function MoneyDays({ days, cid, currency, initialOpen }: { days: MoneyDay[]; cid: number; currency: string; initialOpen?: string | null }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []));
  const fx = currency !== "HUF";
  const cols = fx ? 8 : 7;
  const toggle = (d: string) => setOpen((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const allOpen = days.length > 0 && days.every((d) => open.has(d.date));
  return (
    <>
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
                  <tr className={`md-day${isOpen ? " open" : ""}`} onClick={() => toggle(d.date)}>
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
