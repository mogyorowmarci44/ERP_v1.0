import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { trialBalance, openItems, vehicleStock, vatAnalytics } from "@/lib/reports";
import { fmtHuf } from "@/lib/money";
import { monthEnd, monthStart, today, yearStart } from "@/lib/dates";

export default async function Dashboard({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  await requireCompany(cid);
  const t = today();
  const [tb, recv, pay, stock, vat] = await Promise.all([
    trialBalance(cid, yearStart(t), t),
    openItems(cid, "out"),
    openItems(cid, "in"),
    vehicleStock(cid),
    vatAnalytics(cid, monthStart(t), monthEnd(t)),
  ]);
  const bal = (pred: (code: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
  const cash = bal((c) => c.startsWith("38"));
  const revenue = -bal((c) => c.startsWith("9"));
  const costs = bal((c) => c.startsWith("5") || c.startsWith("8"));
  const inStock = stock.filter((v) => v.status !== "sold");
  const stockValue = inStock.reduce((s, v) => s + v.bookValue, 0);
  const recvHuf = recv.reduce((s, r) => s + (r.currency === "HUF" ? r.openFx : (r.openFx * Number(r.grossHuf)) / Number(r.grossFx || 1)), 0);
  const payHuf = pay.reduce((s, r) => s + (r.currency === "HUF" ? r.openFx : (r.openFx * Number(r.grossHuf)) / Number(r.grossFx || 1)), 0);

  return (
    <>
      <div className="topbar">
        <h1>Áttekintés</h1>
        <Link className="btn" href={`/c/${cid}/reports/statements?type=pnl&gran=month`}>Havi eredménykimutatás</Link>
      </div>
      <div className="grid cols-4">
        <div className="card stat primary"><div className="label">Pénzeszközök (bank + pénztár)</div><div className="value">{fmtHuf(cash)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Gépkocsi készlet ({inStock.length} db)</div><div className="value">{fmtHuf(stockValue)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Nyitott vevők</div><div className="value">{fmtHuf(recvHuf)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Nyitott szállítók</div><div className="value">{fmtHuf(payHuf)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Árbevétel + egyéb bevétel (év)</div><div className="value">{fmtHuf(revenue)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Költség + ráfordítás (év)</div><div className="value">{fmtHuf(costs)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Eredmény (év, adózás előtt)</div><div className="value">{fmtHuf(revenue - costs)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">ÁFA egyenleg (tárgyhó)</div><div className="value">{fmtHuf(vat.balance)}<small>Ft</small></div></div>
      </div>
      <h2>Készleten lévő gépkocsik</h2>
      <table>
        <thead><tr><th>Gépkocsi</th><th>Rendszám</th><th>Adózás</th><th className="num">Könyv szerinti érték</th></tr></thead>
        <tbody>
          {inStock.map((v) => (
            <tr key={v.id}><td><Link href={`/c/${cid}/vehicles?edit=${v.id}`}>{v.make} {v.model} {v.year ?? ""}</Link></td><td className="mono">{v.plate}</td><td>{v.vatTreatment === "margin" ? "különbözeti" : "normál"}</td><td className="num">{fmtHuf(v.bookValue)}</td></tr>
          ))}
          {inStock.length === 0 && <tr><td colSpan={4} className="muted">Nincs készleten gépkocsi.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
