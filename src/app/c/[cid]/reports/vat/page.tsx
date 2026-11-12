import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { vatAnalytics } from "@/lib/reports";
import { noInputVatDeduction } from "@/lib/entity";
import { fmtHuf } from "@/lib/money";
import { isDate, monthStart, monthEnd, today, fmtDate } from "@/lib/dates";

const kindHu: Record<string, string> = {
  normal: "normál", margin: "különbözeti", exempt: "adómentes", out_of_scope: "hatályon kívül", reverse_charge: "fordított", eu_acquisition: "KBB", eu_supply: "KBE", export: "export", non_deductible: "nem levonható",
};

export default async function VatPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : monthStart(today());
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const v = await vatAnalytics(cid, from, to, { noInputVatDeduction: noInputVatDeduction(company) });
  const margin = v.rows.filter((r) => r.vatKind === "margin" && r.direction === "out");
  return (
    <>
      <div className="topbar">
        <h1>ÁFA analitika</h1>
        <span className="muted">{company.name} · {company.taxNumber} · {fmtDate(from)} – {fmtDate(to)}</span>
      </div>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Teljesítés-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Lekérdezés</button>
      </form>
      <div className="grid cols-3">
        <div className="card stat"><div className="label">Fizetendő ÁFA</div><div className="value">{fmtHuf(v.payable)} Ft</div></div>
        <div className="card stat"><div className="label">Levonható ÁFA</div><div className="value">{fmtHuf(v.deductible)} Ft</div></div>
        <div className="card stat"><div className="label">{v.balance >= 0 ? "Befizetendő" : "Visszaigényelhető / következő időszakra"}</div><div className="value">{fmtHuf(Math.abs(v.balance))} Ft</div></div>
      </div>

      <h2>Összesítő ÁFA-kódonként</h2>
      <table>
        <thead><tr><th>Irány</th><th>ÁFA-kód</th><th>Jelleg</th><th className="num">Tételek</th><th className="num">Nettó / adóalap</th><th className="num">ÁFA</th><th className="num">Bruttó</th></tr></thead>
        <tbody>
          {v.summary.map((s) => (
            <tr key={`${s.direction}${s.vatCode}`}>
              <td>{s.direction === "out" ? "Értékesítés" : "Beszerzés"}</td><td>{s.vatCode} – {s.vatName}</td><td>{kindHu[s.vatKind]}</td>
              <td className="num">{s.count}</td><td className="num">{fmtHuf(s.net)}</td><td className="num">{fmtHuf(s.vat)}</td><td className="num">{fmtHuf(s.gross)}</td>
            </tr>
          ))}
          {v.summary.length === 0 && <tr><td colSpan={7} className="muted">Nincs könyvelt számla az időszakban.</td></tr>}
        </tbody>
      </table>

      {margin.length > 0 && (
        <>
          <h2>Különbözeti adózás – használt cikkek (tételes)</h2>
          <table>
            <thead><tr><th>Teljesítés</th><th>Számla</th><th>Vevő</th><th>Megnevezés</th><th className="num">Eladási ár (bruttó)</th><th className="num">Beszerzési ár</th><th className="num">Árrés</th><th className="num">Adóalap</th><th className="num">ÁFA</th></tr></thead>
            <tbody>
              {margin.map((r, k) => (
                <tr key={k}>
                  <td>{fmtDate(r.fulfillmentDate)}</td><td><Link href={`/c/${cid}/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td><td>{r.partnerName}</td><td>{r.description}</td>
                  <td className="num">{fmtHuf(r.grossHuf)}</td><td className="num">{fmtHuf(r.marginPurchaseHuf)}</td>
                  <td className="num">{fmtHuf(Number(r.grossHuf) - Number(r.marginPurchaseHuf))}</td>
                  <td className="num">{fmtHuf(Math.max(0, Number(r.grossHuf) - Number(r.marginPurchaseHuf)) - Number(r.vatHuf))}</td>
                  <td className="num">{fmtHuf(r.vatHuf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Tételes lista</h2>
      <table>
        <thead><tr><th>Irány</th><th>Teljesítés</th><th>Számla</th><th>Partner</th><th>Adószám</th><th>ÁFA-kód</th><th className="num">Nettó</th><th className="num">ÁFA</th></tr></thead>
        <tbody>
          {v.rows.map((r, k) => (
            <tr key={k}>
              <td>{r.direction === "out" ? "É" : "B"}</td><td>{fmtDate(r.fulfillmentDate)}</td>
              <td><Link href={`/c/${cid}/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td><td>{r.partnerName}</td><td className="mono">{r.partnerTax}</td>
              <td>{r.vatCode}</td><td className="num">{fmtHuf(r.netHuf)}</td><td className="num">{fmtHuf(r.vatHuf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Az analitika a teljesítés dátuma szerint gyűjt. A 2665A bevallás sorainak kitöltése és a NAV Online Számla adatokkal való egyeztetés a következő mérföldkő.</p>
    </>
  );
}
