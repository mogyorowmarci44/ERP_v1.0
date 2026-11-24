import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { PrintButton } from "@/components/PrintButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { loadSoldCars, loadStockCars, redDaysOf } from "@/lib/keszlet-merleg";
import { soldView, stockView, type KmGroupBy, type KmStatus } from "@/lib/keszlet-merleg-calc";
import type { AutoMerleg } from "@/lib/auto-merleg-calc";
import { periodOf } from "./period";
import { saveRedDaysAction } from "./actions";
import { PeriodPicker } from "@/components/PeriodPicker";

export const dynamic = "force-dynamic";

const ft = (n: number | null | undefined) => (n == null ? "–" : `${n < 0 ? "−" : ""}${fmtHuf(Math.abs(Math.round(n)))} Ft`);
const sft = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtHuf(Math.abs(Math.round(n)))} Ft`;
const mft = (n: number) => `${n < 0 ? "−" : ""}${(Math.abs(n) / 1e6).toFixed(2).replace(".", ",")} m Ft`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const STATUS: Record<KmStatus, { title: string; hint: string }> = {
  red: { title: "Beavatkozni", hint: "nullszaldó alatt vagy közel" },
  yellow: { title: "Cél alatt", hint: "nyereséges, de a cél alatt" },
  green: { title: "Rendben", hint: "az ár a cél fölött" },
};

/** Mini ársáv egy autóhoz: piros a beszerzésig, sárga a nullszaldóig, onnan zöld; jelölő a célon, pötty az áron. */
function MiniBand({ r }: { r: AutoMerleg }) {
  const lo = Math.min(r.buyCover, r.floor, r.price) * 0.95, hi = Math.max(r.goal, r.price) * 1.04;
  const p = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)).toFixed(1)}%`;
  return (
    <div className="km-band" style={{ background: `linear-gradient(to right, var(--am-red) 0, var(--am-red) ${p(r.buyCover)}, var(--am-yellow) ${p(r.buyCover)}, var(--am-yellow) ${p(r.floor)}, var(--am-green-soft) ${p(r.floor)}, var(--pos) 100%)` }}
      role="img" aria-label={`Ár ${ft(r.price)}, nullszaldó ${ft(r.floor)}, cél ${ft(r.goal)}`}>
      <i style={{ left: p(r.goal) }} /><span style={{ left: p(r.price) }} />
    </div>
  );
}

/** v3.5.0 – KészletMérleg: az összes autó AutóMérlege egy helyen (Készlet: sávok · Eladott: dashboard). */
export default async function KeszletMerlegPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const tab = sp.tab === "sold" ? "sold" : "stock";
  const per = periodOf(sp);
  const groupBy = (["model", "origin", "month"].includes(sp.g) ? sp.g : "none") as KmGroupBy;
  const qs = (o: Record<string, string>) => `?${new URLSearchParams({ ...(sp.p ? { p: sp.p } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...(sp.g ? { g: sp.g } : {}), tab, ...o })}`;
  const car = (id: number) => `/c/${cid}/vehicles/${id}/merleg`;

  const [stockCars, redDays] = await Promise.all([loadStockCars(cid), redDaysOf(cid)]);
  const st = stockView(stockCars, redDays);
  const soldCars = tab === "sold" ? await loadSoldCars(cid, per.from, per.to) : [];
  const so = soldView(soldCars, groupBy);

  return (
    <div className="am km">
      <div className="topbar">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Járművek › KészletMérleg</div>
          <h1>KészletMérleg</h1>
          <span className="muted">{company.name} · az összes autó AutóMérlege egy helyen</span>
        </div>
        <div className="row no-print">
          <div className="segmented" aria-label="Nézet">
            <Link className={tab === "stock" ? "on" : undefined} href={qs({ tab: "stock" })}>Készlet ({st.totals.count})</Link>
            <Link className={tab === "sold" ? "on" : undefined} href={qs({ tab: "sold" })}>Eladott</Link>
          </div>
          <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>Gépkocsi készlet</Link>
          <a className="btn" href={`/c/${cid}/vehicles/merleg/export${qs({})}`}>Excel</a>
          <PrintButton />
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      {tab === "stock" ? (
        <>
          <div className="am-kpis">
            <div className="card stat"><div className="label">Lekötött pénz</div><div className="value">{mft(st.totals.capital)}</div><div className="muted am-kpi-sub">{st.totals.count} autó</div></div>
            <div className="card stat"><div className="label">Tartási költség</div><div className="value">{fmtHuf(st.totals.holdingPerDay)}<small>Ft/nap</small></div><div className="muted am-kpi-sub">eddig összesen {ft(st.totals.holding)}</div></div>
            <div className="card stat"><div className="label">Várható nettó fedezet</div><div className={`value ${st.totals.f2 >= 0 ? "pos" : "neg"}`}>{mft(st.totals.f2)}</div><div className="muted am-kpi-sub">tartási költséggel {mft(st.totals.f3)}</div></div>
            <div className="card stat primary"><div className="label">Állapot</div><div className="km-status-count"><span className="r">{st.red.length} piros</span><span className="y">{st.yellow.length} sárga</span><span className="g">{st.green.length} zöld</span></div></div>
          </div>
          <div className="km-lanes">
            {(["red", "yellow", "green"] as const).map((s) => (
              <section key={s} className={`km-lane ${s}`} aria-label={STATUS[s].title}>
                <header><b>{STATUS[s].title} · {st[s].length}</b><span>{s === "red" ? `nullszaldó alatt vagy ${redDays} napon belül` : STATUS[s].hint}</span></header>
                {st[s].map((x) => (
                  <article key={x.id} className="km-card">
                    <div className="km-card-top"><Link href={car(x.id)}><b>{x.title}</b></Link><span className="muted">{x.plate ?? ""}</span></div>
                    <div className="km-card-line"><span>{x.r.days ?? "–"} nap · {ft(x.r.price)}{x.r.priceSource === "arsugo" ? <span className="muted" title="Nincs Forecast-terv: az ÁrSugó javasolt ára"> (javasolt)</span> : null}</span>
                      <b className={s === "green" ? "pos" : s === "red" ? "neg" : "warn"}>{s === "green" ? ft(x.r.f2) : x.r.price < x.r.floor ? "nullszaldó alatt" : `${x.r.daysToFloor} nap a nullszaldóig`}</b></div>
                    <MiniBand r={x.r} />
                    <div className="km-card-line muted"><span>Nullszaldó {ft(x.r.floor)}</span><span>Cél {ft(x.r.goal)}</span></div>
                    {s === "red" && (
                      <div className="km-card-actions no-print">
                        <Link className="btn primary" href={`/c/${cid}/arsugo?vehicle=${x.id}`}>ÁrSugó</Link>
                        <Link className="btn" href={car(x.id)}>AutóMérleg</Link>
                      </div>
                    )}
                  </article>
                ))}
                {!st[s].length && <p className="muted km-empty">Nincs ilyen autó.</p>}
              </section>
            ))}
          </div>
          <form action={saveRedDaysAction} className="row km-foot-form no-print">
            <input type="hidden" name="cid" value={cid} />
            <span className="muted">Az ár forrása: a Forecastban rögzített eladási ár, ennek híján az ÁrSugó javasolt ára. Piros, ha a nullszaldót</span>
            <input name="days" className="num" defaultValue={redDays} style={{ width: 64 }} aria-label="Napok" disabled={!canWrite} />
            <span className="muted">napon belül eléri.</span>
            {canWrite && <button>Mentés</button>}
          </form>
        </>
      ) : (
        <>
          <form className="row km-filters no-print">
            <input type="hidden" name="tab" value="sold" />
            <input type="hidden" name="p" value="custom" />
            <PeriodPicker unit="day" label="Időszak" from={per.from} to={per.to} today={today()} />
            <label>Csoportosítás
              <select name="g" defaultValue={groupBy}>
                <option value="none">Nincs</option><option value="model">Márka / modell</option><option value="origin">Import / belföld</option><option value="month">Hónap</option>
              </select>
            </label>
            <button className="primary">Mutasd</button>
          </form>

          {!so.rows.length ? <div className="card"><p className="muted" style={{ margin: 0 }}>Ebben az időszakban ({per.label}) nincs eladott autó.</p></div> : (
            <>
              <div className="am-kpis">
                <div className="card stat"><div className="label">Eladott autók</div><div className="value">{so.totals.count}<small>db</small></div><div className="muted am-kpi-sub">medián állásidő {so.totals.medDays == null ? "–" : `${Math.round(so.totals.medDays)} nap`}</div></div>
                <div className="card stat"><div className="label">Bruttó fedezet</div><div className="value">{mft(so.totals.f1)}</div><div className="muted am-kpi-sub">nettó árbevétel − vételár</div></div>
                <div className="card stat"><div className="label">Nettó fedezet</div><div className={`value ${so.totals.f2 >= 0 ? "pos" : "neg"}`}>{mft(so.totals.f2)}</div><div className="muted am-kpi-sub">fedezet % {pct(so.totals.pct)}</div></div>
                <div className="card stat"><div className="label">Medián nettó fedezet</div><div className="value">{fmtHuf(Math.round(so.totals.medF2 ?? 0))}<small>Ft</small></div><div className="muted am-kpi-sub">autónként</div></div>
                <div className="card stat primary"><div className="label">Medián napi fedezet</div><div className="value">{fmtHuf(Math.round(so.totals.medPerDay ?? 0))}<small>Ft/nap</small></div><div className="am-kpi-sub">nettó fedezet ÷ állásnap</div></div>
              </div>

              <div className="am-row">
                <LeakChart leak={so.leak} />
                <Scatter points={so.scatter} carHref={car} />
              </div>

              <div className="am-row">
                <RankList title="Legjobb 5 (napi fedezet)" rows={so.top} carHref={car} />
                <RankList title="Leggyengébb 5 (napi fedezet)" rows={so.bottom} carHref={car} />
              </div>

              {so.groups.length > 0 && (
                <div className="card">
                  <h2>Csoportok</h2>
                  <div style={{ overflowX: "auto" }}><table>
                    <thead><tr><th>{groupBy === "model" ? "Márka / modell" : groupBy === "origin" ? "Származás" : "Hónap"}</th><th className="num">db</th><th className="num">Bruttó fedezet</th><th className="num">Nettó fedezet</th><th className="num">Fedezet %</th><th className="num">Medián nettó fedezet</th><th className="num">Medián állásidő</th><th className="num">Medián napi fedezet</th></tr></thead>
                    <tbody>{so.groups.map((g) => (
                      <tr key={g.key}><td>{g.key || "–"}</td><td className="num">{g.count}</td><td className="num">{fmtHuf(Math.round(g.f1))}</td><td className={`num ${g.f2 < 0 ? "neg" : ""}`}>{fmtHuf(Math.round(g.f2))}</td><td className="num">{pct(g.pct)}</td>
                        <td className="num">{g.medF2 == null ? "–" : fmtHuf(Math.round(g.medF2))}</td><td className="num">{g.medDays == null ? "–" : `${Math.round(g.medDays)} nap`}</td><td className="num">{g.medPerDay == null ? "–" : fmtHuf(Math.round(g.medPerDay))}</td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              )}

              <div className="card">
                <h2>Minden eladott autó · {per.label}</h2>
                <div style={{ overflowX: "auto" }}><table>
                  <thead><tr><th>Autó</th><th>Eladás</th><th className="num">Nap</th><th className="num">Eladási ár</th><th className="num">Bruttó fedezet</th><th className="num">Nettó fedezet</th><th className="num">%</th><th className="num">Napi fedezet</th><th className="num">Eltérés a tervtől</th></tr></thead>
                  <tbody>{so.rows.map((x) => {
                    const net = x.r.rows.find((r) => r.label === "Nettó fedezet");
                    return (
                      <tr key={x.id}><td><Link href={car(x.id)}>{x.title}</Link>{x.plate ? <span className="muted"> · {x.plate}</span> : null}</td><td>{fmtDate(x.saleDate)}</td><td className="num">{x.r.days ?? "–"}</td>
                        <td className="num">{fmtHuf(Math.round(x.r.price))}</td><td className="num">{fmtHuf(Math.round(x.r.f1))}</td><td className={`num ${x.r.f2 < 0 ? "neg" : ""}`}>{fmtHuf(Math.round(x.r.f2))}</td>
                        <td className="num">{pct(x.r.f2Pct)}</td><td className="num">{x.r.perDayMargin == null ? "–" : fmtHuf(Math.round(x.r.perDayMargin))}</td>
                        <td className={`num ${net?.diff == null ? "muted" : net.diff < 0 ? "neg" : "pos"}`}>{net?.diff == null ? "–" : sft(net.diff)}</td></tr>
                    );
                  })}</tbody>
                </table></div>
              </div>
            </>
          )}
        </>
      )}
      <p className="muted am-foot">Mogyorosi Holding™ · KészletMérleg · ugyanaz a számolás, mint az autók AutóMérlegén</p>
    </div>
  );
}

function LeakChart({ leak }: { leak: ReturnType<typeof soldView>["leak"] }) {
  if (!leak.cars) return (
    <div className="card km-leak"><h2>Hová folyt el a fedezet?</h2><p className="muted">Az időszakban eladott autók egyikének sincs terve a Forecastban, ezért nincs mivel összevetni.</p></div>
  );
  const steps = [
    { label: "Tervezett nettó fedezet", from: 0, to: leak.planF2, kind: "plan" },
    { label: "Költségeltérés", from: leak.planF2, to: leak.planF2 + leak.costEffect, kind: leak.costEffect < 0 ? "neg" : "pos" },
    { label: "Áreltérés", from: leak.planF2 + leak.costEffect, to: leak.planF2 + leak.costEffect + leak.priceEffect, kind: leak.priceEffect < 0 ? "neg" : "pos" },
    { label: "Tényleges nettó fedezet", from: 0, to: leak.actualF2, kind: "actual" },
  ];
  const max = Math.max(1, ...steps.map((s) => Math.max(s.from, s.to))) * 1.05;
  const min = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const y = (v: number) => ((v - min) / (max - min)) * 100;
  const gap = leak.planF2 - leak.actualF2;
  return (
    <div className="card km-leak">
      <div className="am-card-head"><h2>Hová folyt el a fedezet?</h2><span className={gap > 0 ? "neg" : "pos"}>{gap > 0 ? `a tervhez képest ${ft(gap)} hiányzik` : `a tervnél ${ft(-gap)}-tal több`}</span></div>
      <div className="km-wf" role="img" aria-label={steps.map((s) => `${s.label}: ${ft(s.to - s.from)}`).join(", ")}>
        {steps.map((s) => (
          <div key={s.label}><div className={`km-wf-bar ${s.kind}`} style={{ bottom: `${y(Math.min(s.from, s.to))}%`, height: `${Math.max(0.8, Math.abs(y(s.to) - y(s.from)))}%` }} /></div>
        ))}
      </div>
      <div className="km-wf-labels">{steps.map((s) => <div key={s.label}><b>{s.kind === "plan" || s.kind === "actual" ? ft(s.to) : sft(s.to - s.from)}</b><span>{s.label}</span></div>)}</div>
      <p className="muted am-note">{leak.cars} autó Forecast-tervével összevetve{leak.without ? ` · ${leak.without} autónak nem volt terve, ezek kimaradnak` : ""}. Az áreltérés a ÁFA-hatással együtt értendő.</p>
    </div>
  );
}

function Scatter({ points, carHref }: { points: { id: number; title: string; days: number; f2: number }[]; carHref: (id: number) => string }) {
  if (!points.length) return null;
  const maxD = Math.max(30, ...points.map((p) => p.days)) * 1.08;
  const minF = Math.min(0, ...points.map((p) => p.f2)), maxF = Math.max(1, ...points.map((p) => p.f2));
  const span = (maxF - minF) * 1.1 || 1, lo = minF - (maxF - minF) * 0.05;
  const medDays = [...points.map((p) => p.days)].sort((a, b) => a - b)[Math.floor(points.length / 2)];
  const medF2 = [...points.map((p) => p.f2)].sort((a, b) => a - b)[Math.floor(points.length / 2)];
  const x = (d: number) => `${(d / maxD) * 100}%`, yy = (f: number) => `${((f - lo) / span) * 100}%`;
  return (
    <div className="card km-scatter">
      <h2>Állásidő és nettó fedezet</h2>
      <div className="km-plot" role="img" aria-label="Pontdiagram: állásidő (vízszintes) és nettó fedezet (függőleges) autónként">
        {minF < 0 && <div className="km-zero" style={{ bottom: yy(0) }} />}
        <div className="km-med-x" style={{ left: x(medDays) }} /><div className="km-med-y" style={{ bottom: yy(medF2) }} />
        {points.map((p) => (
          <Link key={p.id} href={carHref(p.id)} className={`km-dot ${p.f2 < 0 ? "neg" : p.days > medDays && p.f2 < medF2 ? "warn" : "pos"}`} style={{ left: x(p.days), bottom: yy(p.f2) }} title={`${p.title}: ${ft(p.f2)}, ${p.days} nap`} aria-label={`${p.title}: ${ft(p.f2)}, ${p.days} nap`} />
        ))}
        <span className="km-ax km-ax-y">{ft(maxF)}</span><span className="km-ax km-ax-x">{Math.round(maxD)} nap</span>
      </div>
      <p className="muted am-note">Szaggatott vonalak: medián állásidő ({medDays} nap) és medián nettó fedezet ({ft(medF2)}). Narancs: a mediánnál tovább állt és kevesebbet hozott · piros: veszteséges. A pöttyre kattintva az autó AutóMérlege nyílik.</p>
    </div>
  );
}

function RankList({ title, rows, carHref }: { title: string; rows: ReturnType<typeof soldView>["top"]; carHref: (id: number) => string }) {
  return (
    <div className="card km-rank">
      <h2>{title}</h2>
      <table><tbody>{rows.map((x) => (
        <tr key={x.id}><td><Link href={carHref(x.id)}>{x.title}</Link></td><td className={`num ${x.r.f2 < 0 ? "neg" : "pos"}`}>{ft(x.r.f2)}</td><td className="num">{fmtHuf(Math.round(x.r.perDayMargin ?? 0))} Ft/nap</td><td className="num muted">{x.r.days} nap</td></tr>
      ))}</tbody></table>
    </div>
  );
}
