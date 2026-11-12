import { requireCompany } from "@/lib/auth";
import { cashbook, CASH_CATEGORY_LABEL, type CashCategory } from "@/lib/cashbook";
import { fmtHuf, round2 } from "@/lib/money";
import { fmtDate, isDate, today } from "@/lib/dates";
import { PrintButton } from "@/components/PrintButton";

/** v2.0 – Bevételi-kiadási (pénzforgalmi) nyilvántartás. */
export default async function CashbookPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  const t = today();
  const from = isDate(sp.from) ? sp.from : `${t.slice(0, 4)}-01-01`;
  const to = isDate(sp.to) ? sp.to : `${t.slice(0, 4)}-12-31`;
  const cat = (sp.cat ?? "") as CashCategory | "";
  const all = await cashbook(cid, from, to);
  const rows = cat ? all.filter((r) => r.category === cat) : all;
  const totals = new Map<CashCategory, { in: number; out: number }>();
  for (const r of all) {
    const x = totals.get(r.category) ?? { in: 0, out: 0 };
    x.in = round2(x.in + r.inflow);
    x.out = round2(x.out + r.outflow);
    totals.set(r.category, x);
  }
  const sumIn = round2(rows.reduce((s, r) => s + r.inflow, 0));
  const sumOut = round2(rows.reduce((s, r) => s + r.outflow, 0));
  return (
    <>
      <div className="topbar">
        <h1>Bevételi-kiadási nyilvántartás</h1>
        <span className="muted">{company.name} · {company.taxNumber} · {fmtDate(from)} – {fmtDate(to)}</span>
        <PrintButton />
      </div>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <label>Kategória
          <select name="cat" defaultValue={cat}>
            <option value="">mind</option>
            {Object.entries(CASH_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button style={{ alignSelf: "end" }}>Lekérdezés</button>
      </form>

      <div className="grid cols-4">
        {(["revenue", "expense", "tax", "private"] as CashCategory[]).map((k) => {
          const x = totals.get(k) ?? { in: 0, out: 0 };
          return (
            <div key={k} className="card stat">
              <div className="label">{CASH_CATEGORY_LABEL[k]} (be / ki)</div>
              <div className="value">{fmtHuf(x.in - x.out)}<small>Ft</small></div>
              <div className="muted" style={{ fontSize: 12 }}>be {fmtHuf(x.in)} · ki {fmtHuf(x.out)}</div>
            </div>
          );
        })}
      </div>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr><th>Dátum</th><th>Bizonylat</th><th>Megnevezés</th><th>Partner</th><th>Kategória</th><th>Pénzeszköz</th><th className="num">Bevétel</th><th className="num">Kiadás</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.entryId}-${i}`}>
              <td>{fmtDate(r.date)}</td><td className="mono">{r.number}</td>
              <td>{r.description}<div className="muted" style={{ fontSize: 11 }}>{r.counter}</div></td>
              <td>{r.partner ?? ""}</td><td>{CASH_CATEGORY_LABEL[r.category]}</td><td>{r.moneyAccount}</td>
              <td className="num">{r.inflow ? fmtHuf(r.inflow) : ""}</td><td className="num">{r.outflow ? fmtHuf(r.outflow) : ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">Nincs pénzmozgás az időszakban.</td></tr>}
        </tbody>
        <tfoot>
          <tr><th colSpan={6}>Összesen</th><th className="num">{fmtHuf(sumIn)}</th><th className="num">{fmtHuf(sumOut)}</th></tr>
        </tfoot>
      </table>
      <p className="muted">Pénzforgalmi szemlélet: a bank- és pénztárszámlák mozgásai, az ellenszámla szerint kategorizálva. Platformon keresztüli bevételnél (Airbnb) a kifizetés a jutalékkal csökkentett összeg – az SZJA-alap a teljes szállásdíj, ezt az „Adók” oldal a bevételi számlákból számolja.</p>
    </>
  );
}
