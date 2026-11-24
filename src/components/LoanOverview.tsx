"use client";
/** v4.5.1 – Tagi kölcsön › Áttekintés: tömör táblázat, soronkénti pipa a sor okirataihoz, fölül Nyomtatás. */
import Link from "next/link";
import { useMemo, useState } from "react";

export type OverviewDoc = { key: string; label: string; title: string };
export type OverviewRow = {
  entryId: number;
  kind: "loan" | "repayment" | "reval";
  ref: string; // szerződésszám / TKV / naplószám
  refHref: string | null;
  sub: string | null; // → TK-…, ← TKV-…
  date: string;
  amount: string;
  amountFx: string | null;
  due: { from: string | null; to: string | null; mods: number; age: { label: string; level: string } | null } | null;
  note: string | null; // visszafizetésnél: mit zár
  open: string | null;
  openFx: string | null;
  balance: string;
  docs: OverviewDoc[];
};

const TYPE: Record<OverviewRow["kind"], [string, string]> = { loan: ["befizetés", "in"], repayment: ["vissza", "out"], reval: ["átértékelés", "rv"] };

export function LoanOverview({ cid, rows }: { cid: number; rows: OverviewRow[] }) {
  const all = useMemo(() => rows.flatMap((r) => r.docs.map((d) => d.key)), [rows]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (keys: string[], on: boolean) => setSel((s) => { const n = new Set(s); for (const k of keys) (on ? n.add(k) : n.delete(k)); return n; });
  const selRows = rows.filter((r) => r.docs.some((d) => sel.has(d.key))).length;
  const allOn = all.length > 0 && all.every((k) => sel.has(k));
  // a nyomtatási sorrend a táblázat sorrendje (dokumentumonként)
  const ordered = rows.flatMap((r) => r.docs.filter((d) => sel.has(d.key)).map((d) => d.key));
  const printHref = `/c/${cid}/member-loans/print?d=${encodeURIComponent(ordered.join(","))}`;

  return (
    <>
      <div className="lo-bar no-print">
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={allOn} onChange={(e) => setSel(e.target.checked ? new Set(all) : new Set())} aria-label="Minden dokumentum kijelölése" /> mind
        </label>
        <span className="muted">Kijelölve: <strong>{selRows} sor · {ordered.length} dokumentum</strong></span>
        <span style={{ flex: 1 }} />
        <span className="muted small">TK = szerződés · M = módosítás · TKV = visszafizetés</span>
        {ordered.length > 0
          ? <a className="btn primary" href={printHref} target="_blank" rel="noopener">Nyomtatás ({ordered.length})</a>
          : <button className="primary" disabled title="Jelölj ki legalább egy dokumentumot">Nyomtatás</button>}
      </div>
      <table className="lo-table">
        <colgroup><col className="lo-c0" /><col className="lo-c1" /><col className="lo-c2" /><col className="lo-c3" /><col className="lo-c4" /><col className="lo-c5" /><col className="lo-c6" /><col className="lo-c7" /></colgroup>
        <thead>
          <tr><th aria-label="Kijelölés" /><th>Szerződés</th><th>Dátum</th><th>Típus</th><th className="num">Összeg (Ft)</th><th>Lejárat</th><th className="num">Nyitott</th><th className="num">Egyenleg</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const keys = r.docs.map((d) => d.key);
            const on = keys.length > 0 && keys.every((k) => sel.has(k));
            const some = keys.some((k) => sel.has(k));
            return (
              <tr key={r.entryId} className={some ? "sel" : undefined}>
                <td>{keys.length > 0 && <input type="checkbox" checked={on} ref={(el) => { if (el) el.indeterminate = some && !on; }} onChange={(e) => toggle(keys, e.target.checked)} aria-label={`${r.ref} dokumentumai`} />}</td>
                <td>
                  {r.refHref ? <Link href={r.refHref}>{r.ref}</Link> : <span className="mono muted">{r.ref}</span>}
                  {r.docs.length > 0 && (
                    <div className="lo-docs">
                      {r.docs.map((d) => (
                        <button key={d.key} type="button" className={`lo-doc${sel.has(d.key) ? " on" : ""}`} title={d.title} aria-pressed={sel.has(d.key)} onClick={() => toggle([d.key], !sel.has(d.key))}>{d.label}</button>
                      ))}
                    </div>
                  )}
                  {r.sub && <div className="small muted">{r.sub}</div>}
                </td>
                <td>{r.date}</td>
                <td><span className={`lo-type ${TYPE[r.kind][1]}`}>{TYPE[r.kind][0]}</span></td>
                <td className="num">{r.amount}{r.amountFx && <div className="small muted">{r.amountFx}</div>}</td>
                <td>
                  {r.due ? (
                    <>
                      {r.due.mods > 0 && r.due.from ? <>{r.due.from} → <strong>{r.due.to}</strong></> : <strong>{r.due.to ?? <span className="muted">nincs megadva</span>}</strong>}
                      {r.due.age && <div><span className={`loan-age ${r.due.age.level}`}>{r.due.age.label}</span></div>}
                      {r.due.mods > 0 && <div className="small muted">{r.due.mods} módosítás</div>}
                    </>
                  ) : r.note ? <span className="small muted">{r.note}</span> : null}
                </td>
                <td className="num">{r.open ?? "–"}{r.openFx && <div className="small muted">{r.openFx}</div>}</td>
                <td className="num">{r.balance}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={8} className="muted">Nincs tétel.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
