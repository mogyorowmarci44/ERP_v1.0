import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { companyValue, valuationParamsFor } from "@/lib/company-value";
import { SCENARIOS, SCENARIO_LABEL } from "@/lib/forecast";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { saveValuationParamsAction } from "./actions";

export const dynamic = "force-dynamic";

const eFtFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const eFt = (n: number) => `${eFtFmt.format(Math.round(n / 1000) || 0)} eFt`;
const M = (n: number) => `${(Math.round(n / 100000) / 10).toLocaleString("hu-HU", { minimumFractionDigits: 1 })} M Ft`;

function Calc({ lines, total, totalLabel }: { lines: Array<{ label: string; amount: number; hint?: string }>; total: number; totalLabel: string }) {
  return (
    <table className="cv-calc">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.label}{l.hint && <div className="muted" style={{ fontSize: 12 }}>{l.hint}</div>}</td>
            <td className={`num${l.amount < 0 ? " neg" : ""}`}>{fmtHuf(l.amount)}</td>
          </tr>
        ))}
        <tr className="total"><td>{totalLabel}</td><td className={`num${total < 0 ? " neg" : ""}`}>{fmtHuf(total)}</td></tr>
      </tbody>
    </table>
  );
}

export default async function CompanyValuePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const canWrite = role !== "viewer";
  const p = await valuationParamsFor(cid);
  const v = await companyValue(cid, p);
  const f = v.forward.scenarios;

  return (
    <div className="cv">
      <div className="topbar">
        <div>
          <h1>Cégérték</h1>
          <span className="muted">{company.name} · {fmtDate(v.asOf)} · a könyvelés és a Forecast mai állapota alapján</span>
        </div>
        <Link className="btn" href={`/c/${cid}`}>← Áttekintés</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid cols-3 lp-kpi">
        <div className="card stat primary"><div className="label">1. Korrigált nettó eszközérték</div><div className={v.nav.value < 0 ? "value neg" : "value"}>{M(v.nav.value)}</div><small style={{ opacity: 0.85 }}>ez látszik a csempén</small></div>
        <div className="card stat"><div className="label">2. Eredményszorzós ({p.multiple}×)</div><div className={v.multiple.value < 0 ? "value neg" : "value"}>{M(v.multiple.value)}</div></div>
        <div className="card stat"><div className="label">3. Előretekintő (Forecast)</div>
          {v.forward.empty ? <div className="value muted">–</div> : <div className="value">{M(f.base.value)}</div>}
          {!v.forward.empty && <small className="muted">sáv: {M(Math.min(f.pessimistic.value, f.optimistic.value))} – {M(Math.max(f.pessimistic.value, f.optimistic.value))}</small>}
        </div>
      </div>

      <section className="card cv-sec">
        <h2>1. Korrigált nettó eszközérték <span className="muted">– „ha ma eladnánk mindent”</span></h2>
        <p className="muted">A könyv szerinti saját tőke, ahol a készletet a Forecastban megadott eladási áron vesszük figyelembe (különbözeti ÁFA és a még hátralévő tervezett költségek nélkül), a várható nyereség adójával csökkentve. Tény alapú, minden könyveléssel és tervmódosítással frissül.</p>
        <Calc lines={v.nav.lines} total={v.nav.value} totalLabel="Korrigált nettó eszközérték" />
        {v.nav.stock.length > 0 && (
          <details className="fc-more" style={{ marginTop: 10 }}>
            <summary>Készlet átértékelése autónként ({v.nav.stock.length} db)</summary>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Gépkocsi</th><th className="num">Könyv szerinti érték</th><th className="num">Tervezett eladási ár</th><th className="num">Különbözeti ÁFA</th><th className="num">Hátralévő költség</th><th className="num">Nettó eladási érték</th><th className="num">Átértékelés</th></tr></thead>
                <tbody>
                  {v.nav.stock.map((s, i) => (
                    <tr key={i}>
                      <td>{s.label}</td>
                      <td className="num">{fmtHuf(s.bookValue)}</td>
                      <td className="num">{s.salePrice ? fmtHuf(s.salePrice) : <span className="muted">nincs terv</span>}</td>
                      <td className="num">{s.salePrice ? fmtHuf(s.marginVat) : "–"}</td>
                      <td className="num">{s.salePrice ? fmtHuf(s.plannedCosts) : "–"}</td>
                      <td className="num">{fmtHuf(s.netRealizable)}</td>
                      <td className={`num${s.uplift < 0 ? " neg" : ""}`}>{fmtHuf(s.uplift)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Eladási árat a <Link href={`/c/${cid}/forecast/stock`}>Forecast › Készlet és eladások</Link> fülön adhatsz meg.</p>
          </details>
        )}
      </section>

      <section className="card cv-sec">
        <h2>2. Eredményszorzós érték <span className="muted">– amit egy vevő fizetne a működő cégért</span></h2>
        <p className="muted">
          Az elmúlt 12 hónap adózás előtti eredménye értékcsökkenés nélkül, megszorozva egy piaci szorzóval, plusz a cégben lévő pénz, mínusz a hitelek és a tagi kölcsön.
          Kis használtautó-kereskedéseknél a szorzó jellemzően 2–4. {v.multiple.annualized && <strong>A cég még nem működik egy éve – az eredmény évesítve.</strong>}
        </p>
        <Calc lines={v.multiple.lines} total={v.multiple.value} totalLabel="Eredményszorzós érték" />
      </section>

      <section className="card cv-sec">
        <h2>3. Előretekintő érték <span className="muted">– a Forecast alapján</span></h2>
        {v.forward.empty ? (
          <p className="muted">Nincs kitöltött Forecast (eladási terv vagy költségtétel), ezért ez a módszer nem számolható. <Link href={`/c/${cid}/forecast`}>Forecast megnyitása</Link></p>
        ) : (
          <>
            <p className="muted">
              A könyv szerinti saját tőkéhez hozzáadjuk a következő {v.forward.months} hónap tervezett, adózott eredményének jelenértékét. Nem a korrigált értékből indul,
              mert a készlet eladásából várt haszon már benne van a Forecast eredményében – így nincs kétszer számolva.
            </p>
            <Calc lines={v.forward.lines} total={f.base.value} totalLabel="Előretekintő érték (alap)" />
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Forgatókönyv</th><th className="num">Adózás előtti eredmény</th><th className="num">Adózott eredmény</th><th className="num">Jelenérték</th><th className="num">Cégérték</th></tr></thead>
                <tbody>
                  {SCENARIOS.map((s) => (
                    <tr key={s} className={`sc-${s}`}>
                      <td><span className="sc-dot" />{SCENARIO_LABEL[s]}</td>
                      <td className="num">{fmtHuf(f[s].preTax)}</td>
                      <td className="num">{fmtHuf(f[s].afterTax)}</td>
                      <td className="num">{fmtHuf(f[s].pv)}</td>
                      <td className="num"><strong>{fmtHuf(f[s].value)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card cv-sec">
        <h2>Paraméterek</h2>
        <form action={saveValuationParamsAction} className="form-grid">
          <input type="hidden" name="cid" value={cid} />
          <label>Eredményszorzó (×)<input name="multiple" className="num" defaultValue={String(p.multiple)} disabled={!canWrite} /><small className="muted">2. módszer · jellemzően 2–4</small></label>
          <label>Diszkontráta (%/év)<input name="discountRate" className="num" defaultValue={String(Math.round(p.discountRate * 1000) / 10)} disabled={!canWrite} /><small className="muted">3. módszer · a tőke elvárt hozama</small></label>
          <label>TAO + HIPA<input className="num" value={`TAO ${Math.round(v.rates.tao * 1000) / 10}% + HIPA telephelyek szerint`} disabled readOnly /><small className="muted"><a href={`/c/${cid}/closing/taxes`}>Évzárás › TAO és HIPA</a></small></label>
          {canWrite && <div style={{ alignSelf: "end" }}><button className="primary">Mentés</button></div>}
        </form>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Mérleg ma: eszközök {eFt(v.balance.assets)} (pénzeszközök {eFt(v.balance.cash)}, készlet {eFt(v.balance.stockBook)}, vevők {eFt(v.balance.receivables)}) ·
          kötelezettségek {eFt(v.balance.liabilities)} (szállítók {eFt(v.balance.payables)}, tagi kölcsön {eFt(v.balance.memberLoans)}{v.balance.bankLoans ? `, hitelek ${eFt(v.balance.bankLoans)}` : ""}).
          Tájékoztató becslés, nem hivatalos cégértékelés.
        </p>
      </section>
    </div>
  );
}
