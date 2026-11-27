import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { costCenterResults } from "@/lib/cost-centers";
import { fmtHuf } from "@/lib/money";
import { fmtDate, isDate, monthEnd, today, yearStart } from "@/lib/dates";

/** v7.5.0 – Eredmény költséghelyenként / projektenként. */
export default async function CostCentersPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : yearStart();
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const rows = await costCenterResults(cid, from, to);
  const sum = (k: "revenue" | "cost" | "result") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <div className="topbar">
        <div><h1>Eredmény költséghelyenként</h1><span className="muted">{fmtDate(from)} – {fmtDate(to)}</span></div>
        <Link className="btn" href={`/c/${cid}/settings#koltseghely`}>Költséghelyek</Link>
      </div>
      <form className="row no-print" style={{ gap: 8, marginBottom: 12 }}>
        <label>Ettől<input type="date" name="from" defaultValue={from} /></label>
        <label>Eddig<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Frissítés</button>
      </form>
      <table>
        <thead><tr><th>Költséghely</th><th className="num">Bevétel (9)</th><th className="num">Költség, ráfordítás (5, 8)</th><th className="num">Eredmény</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? "none"} className={r.id ? undefined : "muted"}>
              <td>{r.code ? <><span className="mono">{r.code}</span> – {r.name}</> : r.name}</td>
              <td className="num">{fmtHuf(r.revenue)}</td><td className="num">{fmtHuf(r.cost)}</td>
              <td className="num"><strong className={r.result < 0 ? "neg" : undefined}>{fmtHuf(r.result)}</strong></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="muted">Ebben az időszakban nincs eredményt érintő könyvelés.</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot><tr><th>Összesen</th><th className="num">{fmtHuf(sum("revenue"))}</th><th className="num">{fmtHuf(sum("cost"))}</th><th className="num">{fmtHuf(sum("result"))}</th></tr></tfoot>
        )}
      </table>
      <p className="muted" style={{ marginTop: 8 }}>A költséghelyet a számla sorain lehet megadni (Ellenszámla alatt). Az összesen sor megegyezik a könyvelés szerinti eredménnyel (adó előtt).</p>
    </>
  );
}
