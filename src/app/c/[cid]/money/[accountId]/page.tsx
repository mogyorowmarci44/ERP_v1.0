import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { accountLedger } from "@/lib/reports";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, isDate, monthStart, today } from "@/lib/dates";

/** Napi pénztár- / bankjelentés: naponként nyitó, tételek, záró. */
export default async function MoneyAccountPage({ params, searchParams }: { params: Promise<{ cid: string; accountId: string }>; searchParams: Promise<Record<string, string>> }) {
  const p = await params;
  const sp = await searchParams;
  const cid = Number(p.cid);
  const { company } = await requireCompany(cid);
  const [acc] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, Number(p.accountId)), eq(schema.accounts.companyId, cid)));
  if (!acc || !acc.code.startsWith("38")) notFound();
  const t = today();
  const from = isDate(sp.from) ? sp.from : monthStart(t);
  const to = isDate(sp.to) ? sp.to : t;
  const data = await accountLedger(cid, acc.id, from, to);
  const days = new Map<string, typeof data.lines>();
  for (const l of data.lines) days.set(l.date, [...(days.get(l.date) ?? []), l]);
  let open = data.opening;
  const title = acc.code.startsWith("381") ? "Pénztárjelentés" : "Bankszámla-jelentés";

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{title}: {acc.code} {acc.name}</h1>
          <span className="muted">{company.name}, {fmtDate(from)} – {fmtDate(to)}</span>
        </div>
        <Link className="btn no-print" href={`/c/${cid}/money`}>← Pénztár és bank</Link>
      </div>
      <form className="row no-print" style={{ marginBottom: 16 }}>
        <label>Kezdő dátum<input type="date" name="from" defaultValue={from} /></label>
        <label>Záró dátum<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Frissítés</button>
      </form>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Nyitó ({fmtDate(from)})</div><div className="value">{fmtHuf(data.opening)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Bevételek</div><div className="value">{fmtHuf(data.lines.reduce((s, l) => s + Number(l.debit), 0))}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Kiadások</div><div className="value">{fmtHuf(data.lines.reduce((s, l) => s + Number(l.credit), 0))}<small>Ft</small></div></div>
        <div className="card stat primary"><div className="label">Záró ({fmtDate(to)})</div><div className="value">{fmtHuf(data.closing)}<small>Ft</small></div></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dátum</th><th>Tétel</th><th>Szöveg</th><th>Partner</th>{acc.currency !== "HUF" && <th className="num">{acc.currency}</th>}<th className="num">Bevétel</th><th className="num">Kiadás</th><th className="num">Egyenleg</th></tr></thead>
          <tbody>
            {[...days.entries()].map(([d, ls]) => {
              const dayOpen = open;
              const close = ls[ls.length - 1].balance;
              open = close;
              return (
                <Fragment key={d}>
                  <tr className="sub"><td colSpan={acc.currency !== "HUF" ? 7 : 6}><strong>{fmtDate(d)}</strong> · nyitó {fmtHuf(dayOpen)} Ft</td><td className="num">{fmtHuf(dayOpen)}</td></tr>
                  {ls.map((l) => (
                    <tr key={l.id}>
                      <td></td>
                      <td className="mono">{l.number}</td>
                      <td>{l.description ?? l.entryDescription}</td>
                      <td>{l.partnerName}</td>
                      {acc.currency !== "HUF" && <td className="num">{l.amountFx ? fmtMoney(Number(l.amountFx), acc.currency) : ""}</td>}
                      <td className="num">{Number(l.debit) ? fmtHuf(l.debit) : ""}</td>
                      <td className="num">{Number(l.credit) ? fmtHuf(l.credit) : ""}</td>
                      <td className={`num${l.balance < 0 ? " neg" : ""}`}>{fmtHuf(l.balance)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {days.size === 0 && <tr><td colSpan={8} className="muted">Nincs mozgás az időszakban.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
