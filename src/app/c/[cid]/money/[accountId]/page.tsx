import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { accountLedger } from "@/lib/reports";
import { fmtHuf, round2 } from "@/lib/money";
import { MoneyDays, type MoneyDay } from "@/components/MoneyDays";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate, isDate, monthStart, today } from "@/lib/dates";

/** Napi pénztár- / bankjelentés: naponta nyitó, bevétel, kiadás, záró; a napra kattintva lenyílnak a tételek. */
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
  // Napi összesítés: nyitó, bevétel, kiadás, záró + a nap tételei
  const dayRows: MoneyDay[] = [];
  let open = data.opening;
  for (const l of data.lines) {
    let d = dayRows[dayRows.length - 1];
    if (!d || d.date !== l.date) {
      d = { date: l.date, open, inflow: 0, outflow: 0, close: open, lines: [] };
      dayRows.push(d);
    }
    const debit = Number(l.debit), credit = Number(l.credit);
    d.inflow = round2(d.inflow + debit);
    d.outflow = round2(d.outflow + credit);
    d.close = l.balance;
    open = l.balance;
    d.lines.push({ id: l.id, entryId: l.entryId, number: l.number, text: l.description ?? l.entryDescription, partner: l.partnerName, debit, credit, balance: l.balance, amountFx: l.amountFx ? Number(l.amountFx) : null });
  }
  const title = acc.code.startsWith("381") ? "Pénztárjelentés" : "Bankszámla-jelentés";

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{title}: {acc.code} {acc.name}</h1>
          <span className="muted">{company.name}, {fmtDate(from)} – {fmtDate(to)}</span>
        </div>
        <div className="row no-print">
          <Link className="btn" href={`/c/${cid}/money`}>← Pénztár és bank</Link>
          <PrintButton label="Nyomtatás (minden tétellel)" />
        </div>
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
      <MoneyDays days={dayRows} cid={cid} currency={acc.currency} initialOpen={isDate(sp.day) ? sp.day : null} from={from} to={to} />
    </>
  );
}
