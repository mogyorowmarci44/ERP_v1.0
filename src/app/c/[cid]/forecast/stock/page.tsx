import { requireCompany } from "@/lib/auth";
import { loadPlans, soldHistory, suggestSale, vehicleLabel } from "@/lib/forecast-data";
import { MIN_CALIBRATION_SALES } from "@/lib/forecast";
import { ForecastTabs } from "@/components/Forecast";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { savePlanAction, deletePlanAction, addPlanCostAction, deletePlanCostAction, fillSuggestionsAction, linkPlanAction } from "../actions";

type Cost = { id: number; description: string; date: string | null; net: number; vatRate: number; deductible: boolean; capitalize: boolean; payment: string };
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const mv = (gross: number, base: number) => Math.max(0, Math.round(((gross - base) * 27) / 127));

function CostList({ cid, costs, canWrite }: { cid: number; costs: Cost[]; canWrite: boolean }) {
  if (!costs.length) return null;
  return (
    <ul className="fc-costs" style={{ listStyle: "none", padding: 0 }}>
      {costs.map((c) => (
        <li key={c.id}>
          <span>{c.description}: {fmtHuf(c.net)} Ft + {c.vatRate}%{c.deductible ? "" : " (nem levonható)"} · {c.capitalize ? "a kocsira" : "költség"} · {c.payment === "cash" ? "kp" : "bank"}{c.date ? ` · ${fmtDate(c.date)}` : ""}</span>
          {canWrite && (
            <form action={deletePlanCostAction}>
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="costId" value={c.id} />
              <button className="link" aria-label={`${c.description} törlése`}>törlés</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddCost({ cid, planId, vehicleId }: { cid: number; planId?: number; vehicleId?: number }) {
  return (
    <details className="fc-more">
      <summary>+ tervezett költség</summary>
      <form action={addPlanCostAction} className="form-grid" style={{ marginTop: 8 }}>
        <input type="hidden" name="cid" value={cid} />
        {planId && <input type="hidden" name="planId" value={planId} />}
        {vehicleId && <input type="hidden" name="vehicleId" value={vehicleId} />}
        <label>Megnevezés<input name="description" placeholder="pl. fényezés" required /></label>
        <label>Nettó (Ft)<input name="net" className="num" required /></label>
        <label>ÁFA<select name="vatRate" defaultValue="27"><option value="27">27%</option><option value="18">18%</option><option value="5">5%</option><option value="0">0% / mentes / hatósági díj</option></select></label>
        <label>Levonható?<select name="deductible" defaultValue="yes"><option value="yes">igen</option><option value="no">nem</option></select></label>
        <label>Elszámolás<select name="capitalize" defaultValue="yes"><option value="yes">a kocsi értékét növeli</option><option value="no">azonnal költség</option></select></label>
        <label>Fizetés<select name="payment" defaultValue="cash"><option value="cash">készpénz</option><option value="bank">bank</option></select></label>
        <label>Dátum<input type="date" name="date" defaultValue={today()} /></label>
        <div style={{ alignSelf: "end" }}><button>Hozzáadás</button></div>
      </form>
    </details>
  );
}

export default async function ForecastStockPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [{ stock, planned, closed }, hist] = await Promise.all([loadPlans(cid), soldHistory(cid)]);
  const t = today();
  const unplanned = stock.filter((s) => !s.plan?.salePrice || !s.plan?.saleDate).length;
  const freeVehicles = stock.filter((s) => !s.plan);

  return (
    <div className="viz-sc">
      <h1>Forecast</h1>
      <ForecastTabs cid={cid} active="stock" />
      <Flash error={sp.error} ok={sp.ok} />

      <div className="fc-head">
        <p className="muted" style={{ margin: 0 }}>
          Ez az <strong>alap</strong> forgatókönyv (a te inputod). A rosszabb és a jobb ebből számolódik a Forgatókönyvek fülön megadott eltérésekkel.
        </p>
        {canWrite && unplanned > 0 && (
          <form action={fillSuggestionsAction}>
            <input type="hidden" name="cid" value={cid} />
            <button className="primary">Javaslat kitöltése {unplanned} autóra</button>
          </form>
        )}
      </div>
      {unplanned > 0 && (
        <p className="muted">
          A javaslat {hist.length >= MIN_CALIBRATION_SALES ? `${hist.length} korábbi eladás mediánja (felár a könyv szerinti értékre, napok készleten)` : "alapértelmezés: könyv szerinti érték +15%, 45 nap"} alapján – utána írd át az árakat.
        </p>
      )}

      <h2>Készleten ({stock.length} autó)</h2>
      <div className="table-wrap">
        <table className="fc-plan">
          <thead>
            <tr><th>Gépkocsi</th><th className="num">Könyv szerinti érték</th><th className="num">ÁFA-alap</th><th>Eladási terv (bruttó ár, dátum, fizetés)</th><th className="num">Különbözeti ÁFA</th><th className="num">Fedezet</th></tr>
          </thead>
          <tbody>
            {stock.map((s) => {
              const p = s.plan;
              const costs = (p?.costs ?? []).map((c) => ({ ...c, net: Number(c.net) }));
              const capCost = costs.filter((c) => c.capitalize).reduce((a, c) => a + c.net + (c.deductible ? 0 : Math.round((c.net * c.vatRate) / 100)), 0);
              const price = p?.salePrice ? Number(p.salePrice) : null;
              const vat = price ? mv(price, s.marginBase) : null;
              const margin = price ? price - vat! - s.bookValue - capCost : null;
              const sug = !price ? suggestSale(s.bookValue, s.vehicle.purchaseDate, hist) : null;
              return (
                <tr key={s.vehicle.id}>
                  <td>
                    <strong>{vehicleLabel(s.vehicle)}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {s.vehicle.vin ?? ""}{s.vehicle.purchaseDate ? ` · vétel ${fmtDate(s.vehicle.purchaseDate)} · ${days(s.vehicle.purchaseDate, t)} napja készleten` : ""}
                    </div>
                    <CostList cid={cid} costs={costs} canWrite={canWrite} />
                    {canWrite && <AddCost cid={cid} planId={p?.id} vehicleId={p ? undefined : s.vehicle.id} />}
                  </td>
                  <td className="num">{fmtHuf(s.bookValue)}{capCost > 0 && <div className="muted" style={{ fontSize: 12 }}>+ {fmtHuf(capCost)} terv</div>}</td>
                  <td className="num">{s.marginBase > 0 ? fmtHuf(s.marginBase) : <span className="neg">hiányzik</span>}</td>
                  <td>
                    {canWrite ? (
                      <form action={savePlanAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <input type="hidden" name="cid" value={cid} />
                        <input type="hidden" name="vehicleId" value={s.vehicle.id} />
                        {p && <input type="hidden" name="planId" value={p.id} />}
                        <input name="salePrice" className="num" style={{ width: 120 }} defaultValue={price ?? ""} placeholder={sug ? fmtHuf(sug.price) : ""} aria-label="Bruttó eladási ár" />
                        <input type="date" name="saleDate" defaultValue={p?.saleDate ?? ""} aria-label="Eladás dátuma" />
                        <select name="salePayment" defaultValue={p?.salePayment ?? "bank"} aria-label="Fizetés módja"><option value="bank">utalás</option><option value="cash">készpénz</option></select>
                        <input type="hidden" name="note" value={p?.note ?? ""} />
                        <button>Mentés</button>
                      </form>
                    ) : price ? `${fmtHuf(price)} Ft · ${fmtDate(p?.saleDate)}` : "–"}
                    {p?.note && <div className="muted" style={{ fontSize: 12 }}>{p.note}</div>}
                  </td>
                  <td className="num">{vat !== null ? fmtHuf(vat) : <span className="muted">–</span>}</td>
                  <td className="num">{margin !== null ? <span className={margin < 0 ? "neg" : undefined}>{fmtHuf(margin)}</span> : <span className="muted">–</span>}</td>
                </tr>
              );
            })}
            {stock.length === 0 && <tr><td colSpan={6} className="muted">Nincs gépkocsi készleten.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Tervezett beszerzések</h2>
      <div className="table-wrap">
        <table className="fc-plan">
          <thead><tr><th>Megnevezés</th><th>Beszerzés (bruttó ár = ÁFA-alap, dátum, fizetés)</th><th>Eladás (bruttó ár, dátum, fizetés)</th><th className="num">Különbözeti ÁFA</th><th className="num">Fedezet</th><th /></tr></thead>
          <tbody>
            {planned.map((p) => {
              const costs = p.costs.map((c) => ({ ...c, net: Number(c.net) }));
              const capCost = costs.filter((c) => c.capitalize).reduce((a, c) => a + c.net + (c.deductible ? 0 : Math.round((c.net * c.vatRate) / 100)), 0);
              const buy = Number(p.purchasePrice ?? 0), price = p.salePrice ? Number(p.salePrice) : null;
              const vat = price ? mv(price, buy) : null;
              const formId = `plan-${p.id}`;
              return (
                <tr key={p.id}>
                  <td>
                    {canWrite ? <input form={formId} name="label" defaultValue={p.label ?? ""} aria-label="Megnevezés" /> : p.label}
                    <CostList cid={cid} costs={costs} canWrite={canWrite} />
                    {canWrite && <AddCost cid={cid} planId={p.id} />}
                    {canWrite && freeVehicles.length > 0 && (
                      <details className="fc-more">
                        <summary>megvettük – összekapcsolás a gépkocsival</summary>
                        <form action={linkPlanAction} className="row" style={{ gap: 6, marginTop: 6 }}>
                          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="planId" value={p.id} />
                          <select name="vehicleId">{freeVehicles.map((s) => <option key={s.vehicle.id} value={s.vehicle.id}>{vehicleLabel(s.vehicle)}</option>)}</select>
                          <button>Összekapcsolás</button>
                        </form>
                      </details>
                    )}
                  </td>
                  {canWrite ? (
                    <>
                      <td>
                        <form id={formId} action={savePlanAction}>
                          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="planId" value={p.id} />
                        </form>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <input form={formId} name="purchasePrice" className="num" style={{ width: 120 }} defaultValue={p.purchasePrice ?? ""} aria-label="Vételár" />
                          <input form={formId} type="date" name="purchaseDate" defaultValue={p.purchaseDate ?? ""} aria-label="Vétel dátuma" />
                          <select form={formId} name="purchasePayment" defaultValue={p.purchasePayment} aria-label="Vétel fizetése"><option value="cash">készpénz</option><option value="bank">utalás</option></select>
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <input form={formId} name="salePrice" className="num" style={{ width: 120 }} defaultValue={p.salePrice ?? ""} aria-label="Eladási ár" />
                          <input form={formId} type="date" name="saleDate" defaultValue={p.saleDate ?? ""} aria-label="Eladás dátuma" />
                          <select form={formId} name="salePayment" defaultValue={p.salePayment} aria-label="Eladás fizetése"><option value="bank">utalás</option><option value="cash">készpénz</option></select>
                          <button form={formId}>Mentés</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{fmtHuf(buy)} Ft · {fmtDate(p.purchaseDate)}</td>
                      <td>{price ? `${fmtHuf(price)} Ft · ${fmtDate(p.saleDate)}` : "–"}</td>
                    </>
                  )}
                  <td className="num">{vat !== null ? fmtHuf(vat) : "–"}</td>
                  <td className="num">{price ? fmtHuf(price - vat! - buy - capCost) : "–"}</td>
                  <td>
                    {canWrite && (
                      <form action={deletePlanAction}>
                        <input type="hidden" name="cid" value={cid} /><input type="hidden" name="planId" value={p.id} />
                        <button className="link">törlés</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {planned.length === 0 && <tr><td colSpan={6} className="muted">Nincs tervezett beszerzés.</td></tr>}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form action={savePlanAction} className="card form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="cid" value={cid} />
          <label>Megnevezés<input name="label" placeholder="pl. Lancer 2012" required /></label>
          <label>Vételár (bruttó, Ft)<input name="purchasePrice" className="num" required /></label>
          <label>Vétel dátuma<input type="date" name="purchaseDate" required defaultValue={t} /></label>
          <label>Vétel fizetése<select name="purchasePayment" defaultValue="cash"><option value="cash">készpénz</option><option value="bank">utalás</option></select></label>
          <label>Eladási ár (bruttó, Ft)<input name="salePrice" className="num" /></label>
          <label>Eladás dátuma<input type="date" name="saleDate" /></label>
          <label>Eladás fizetése<select name="salePayment" defaultValue="bank"><option value="bank">utalás</option><option value="cash">készpénz</option></select></label>
          <div style={{ alignSelf: "end" }}><button className="primary">Tervezett beszerzés hozzáadása</button></div>
        </form>
      )}

      <h2>Terv és tény (eladott autók)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Gépkocsi</th><th className="num">Terv ár</th><th className="num">Tény ár</th><th className="num">Eltérés</th><th>Terv dátum</th><th>Tény dátum</th><th className="num">Csúszás (nap)</th></tr></thead>
          <tbody>
            {closed.map((c) => {
              const plan = Number(c.plan.salePrice ?? 0);
              return (
                <tr key={c.plan.id}>
                  <td>{vehicleLabel(c.vehicle)}</td>
                  <td className="num">{plan ? fmtHuf(plan) : "–"}</td>
                  <td className="num">{fmtHuf(c.actualGross)}</td>
                  <td className="num">{plan ? <span className={c.actualGross - plan < 0 ? "neg" : undefined}>{fmtHuf(c.actualGross - plan)} ({(((c.actualGross - plan) / plan) * 100).toLocaleString("hu-HU", { maximumFractionDigits: 1 })}%)</span> : "–"}</td>
                  <td>{fmtDate(c.plan.saleDate)}</td>
                  <td>{fmtDate(c.actualDate)}</td>
                  <td className="num">{c.plan.saleDate && c.actualDate ? days(c.plan.saleDate, c.actualDate) : "–"}</td>
                </tr>
              );
            })}
            {closed.length === 0 && <tr><td colSpan={7} className="muted">Még nincs eladott autó, amire terv volt. Amint egy tervezett autóról kimegy a vevőszámla, itt látszik a terv és a tény.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
