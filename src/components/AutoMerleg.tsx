"use client";
/** v3.4.0 – AutóMérleg nézet (A + C design): KPI-k, ársáv, terv kontra tény, „miért tér el”, vízesés, tartási költség. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { autoMerleg, type MerlegInput } from "@/lib/auto-merleg-calc";
import type { MerlegMeta } from "@/lib/auto-merleg";
import { fmtHuf } from "@/lib/money";

const ft = (n: number) => `${n < 0 ? "−" : ""}${fmtHuf(Math.abs(Math.round(n)))} Ft`;
const sft = (n: number | null) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtHuf(Math.abs(Math.round(n)))} Ft`);
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const hu = (d: string | null) => (d ? `${d.slice(0, 4)}. ${d.slice(5, 7)}. ${d.slice(8, 10)}.` : "–");
const num = (s: string) => Number(s.replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
const WATER_COLOR: Record<string, string> = { buy: "var(--am-buy)", cost: "var(--am-cost)", epr: "var(--am-epr)", hold: "var(--am-hold)", vat: "var(--am-vat)", margin: "var(--pos)", loss: "var(--neg)" };

export function AutoMerlegView({ input, meta, cid, canWrite, saveHolding }: {
  input: MerlegInput; meta: MerlegMeta; cid: number; canWrite: boolean; saveHolding: (fd: FormData) => Promise<void>;
}) {
  const [rate, setRate] = useState(String(input.holding.ratePct).replace(".", ","));
  const [fix, setFix] = useState(String(input.holding.fixPerDay));
  const holding = { ratePct: num(rate), fixPerDay: num(fix) };
  const r = useMemo(() => autoMerleg({ ...input, holding }), [input, holding.ratePct, holding.fixPerDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const sold = r.sold;
  const changed = holding.ratePct !== input.holding.ratePct || holding.fixPerDay !== input.holding.fixPerDay;

  // ársáv
  const lo = Math.floor((Math.min(r.buyCover, r.floor, r.price) * 0.92) / 10000) * 10000;
  const hi = Math.ceil((Math.max(r.goal, r.price, r.ask) * 1.06) / 10000) * 10000;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)).toFixed(2)}%`;
  const track = `linear-gradient(to right, var(--am-red) 0, var(--am-red) ${pos(r.buyCover)}, var(--am-yellow) ${pos(r.buyCover)}, var(--am-yellow) ${pos(r.floor)}, var(--am-green-soft) ${pos(r.floor)}, var(--pos) 100%)`;
  const priceLabel = sold ? "Eladási ár" : r.priceSource === "plan" ? "Tervezett ár" : "Javasolt ár";
  const total = r.water.reduce((a, w) => a + w.amount, 0) || 1;
  let acc = 0;
  const water = r.water.map((w) => { const left = (acc / total) * 100; acc += w.amount; return { ...w, left, width: Math.max(0.6, (w.amount / total) * 100) }; });

  const status = sold ? `Eladva · ${hu(meta.saleDate)}${meta.buyer ? ` · ${meta.buyer}` : ""}` : meta.status === "reserved" ? "Foglalva" : "Készleten";
  return (
    <div className="am">
      <div className="topbar am-head">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Járművek › <Link href={`/c/${cid}/vehicles/merleg`}>KészletMérleg</Link> › AutóMérleg</div>
          <h1>{meta.title}{meta.year ? ` · ${meta.year}` : ""}</h1>
          <div className="am-sub">
            <span className={`am-pill ${sold ? "sold" : "stock"}`}>{status}</span>
            {meta.plate && <span>{meta.plate}</span>}{meta.vin && <span>{meta.vin}</span>}
            <span>Vétel: {hu(meta.purchaseDate)}{meta.seller ? ` · ${meta.seller}` : ""} · {meta.vatTreatment === "margin" ? "különbözeti" : "normál ÁFA"}</span>
          </div>
        </div>
        <div className="row no-print">
          <Link className="btn" href={`/c/${cid}/vehicles/merleg`}>← KészletMérleg</Link>
          {meta.hasMarginCard && <Link className="btn" href={`/c/${cid}/vehicles/${meta.vehicleId}/karton`}>Karton</Link>}
          <Link className="btn" href={`/c/${cid}/vehicles/${meta.vehicleId}/epr`}>EPR</Link>
          <button type="button" className="btn" onClick={() => window.print()}>PDF / Nyomtatás</button>
          {!sold && <Link className="btn primary" href={`/c/${cid}/arsugo?vehicle=${meta.vehicleId}`}>Árazás az ÁrSugóban</Link>}
        </div>
      </div>

      <div className="am-kpis">
        <div className="card stat"><div className="label">{sold ? "Nettó fedezet" : "Várható nettó fedezet"}</div><div className={`value ${r.f2 >= 0 ? "pos" : "neg"}`}>{fmtHuf(Math.round(r.f2))}<small>Ft</small></div><div className="muted am-kpi-sub">{priceLabel} {ft(r.price)}</div></div>
        <div className="card stat"><div className="label">Fedezet %</div><div className="value">{pct(r.f2Pct)}</div><div className="muted am-kpi-sub">Bruttó fedezet: {ft(r.f1)}</div></div>
        <div className="card stat"><div className="label">{sold ? "Állásidő" : "Áll eddig"}</div><div className="value">{r.days ?? "–"}<small>nap</small></div>
          <div className={`am-kpi-sub ${r.vsPeersDays == null ? "muted" : r.vsPeersDays > 0 ? "neg" : "pos"}`}>{r.vsPeersDays == null ? "nincs medián" : `${r.vsPeersDays > 0 ? "+" : ""}${r.vsPeersDays} nap a mediánhoz (${input.peers.medDays} nap)`}</div></div>
        <div className="card stat primary"><div className="label">{sold ? "Napi fedezet" : "Napi fedezet eddig"}</div><div className="value">{r.perDayMargin == null ? "–" : fmtHuf(Math.round(r.perDayMargin))}<small>Ft/nap</small></div><div className="am-kpi-sub">nettó fedezet ÷ állásnapok</div></div>
      </div>

      {r.warn && <div className="am-warn">{priceLabel} ({ft(r.price)}) a mai cél ár ({ft(r.goal)}) alatt van. A nullszaldót (ma {ft(r.floor)}) {r.daysToFloor === 0 ? "már elérte." : `kb. ${r.daysToFloor} nap múlva éri el.`}</div>}
      {r.invalidCombo && <div className="am-warn">Normál ÁFÁ-s vétel után nem lehet különbözeti eladás – normál ÁFÁ-val számolva.</div>}

      <div className="card am-band-card">
        <div className="am-card-head"><h2>Ársáv – a tényleges számokkal</h2>{!sold && <span className="muted">Tartási költség {ft(r.holdingPerDay)}/nap → a nullszaldó naponta {ft(r.creep)}-tal kúszik feljebb</span>}</div>
        <div className="am-labels"><div style={{ left: pos(r.goal) }}><b className="pos">Cél</b><span>{ft(r.goal)}</span></div><div style={{ left: pos(r.price) }}><b className="am-accent">{priceLabel}</b><span>{ft(r.price)}</span></div></div>
        <div className="am-band" style={{ background: track }}>
          <i style={{ left: pos(r.buyCover), background: "var(--neg)" }} /><i style={{ left: pos(r.floor), background: "var(--warn)" }} /><i style={{ left: pos(r.goal), background: "var(--pos)" }} />
          <span className="am-dot" style={{ left: pos(r.price) }} />
        </div>
        <div className="am-labels below"><div style={{ left: pos(r.buyCover) }}><b className="neg">Beszerzés</b><span>{ft(r.buyCover)}</span></div><div style={{ left: pos(r.floor) }}><b className="warn">Nullszaldó</b><span>{ft(r.floor)}</span></div></div>
        <div className="am-legend muted"><span><i className="l-red" />beszerzési ár alatt</span><span><i className="l-yellow" />költségek + ÁFA még nincs fedezve</span><span><i className="l-green" />profit</span></div>
      </div>

      <div className="am-row">
        <div className="card am-cmp">
          <h2>Terv kontra tény</h2>
          <table>
            <thead><tr><th>Tétel</th><th className="num">Terv</th><th className="num">Tény</th><th className="num">Eltérés</th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.label}><td>{x.label}</td><td className="num muted">{x.plan == null ? "–" : ft(x.plan)}</td><td className="num">{ft(x.actual)}</td>
                  <td className={`num ${x.good == null ? "muted" : x.good ? "pos" : "neg"}`}>{x.diff == null ? "–" : sft(x.diff)}</td></tr>
              ))}
              {r.daysRow && <tr className="k-subtotal"><td>{r.daysRow.label}</td><td className="num muted">{r.daysRow.plan == null ? "–" : `${r.daysRow.plan} nap`}</td><td className="num">{r.daysRow.actual} nap</td>
                <td className={`num ${r.daysRow.good == null ? "muted" : r.daysRow.good ? "pos" : "neg"}`}>{r.daysRow.diff == null ? "–" : `${r.daysRow.diff > 0 ? "+" : ""}${r.daysRow.diff} nap`}</td></tr>}
            </tbody>
          </table>
          <p className="muted am-note">Terv: a Forecastban az autóhoz rögzített terv. <Link className="no-print" href={`/c/${cid}/forecast`}>Forecast</Link></p>
        </div>
        <div className="am-side">
          <div className="card"><h2>Miért tér el?</h2><ul className="am-why">{r.why.map((w, i) => <li key={i}>{w}</li>)}{!r.why.length && <li className="muted">Nincs számottevő eltérés.</li>}</ul></div>
          <div className="card">
            <h2>Hasonló autók</h2>
            <div className="muted" style={{ fontSize: 12.5 }}>{input.peers.label} · {input.peers.count} eladott autó</div>
            <div className="am-kv"><span>Medián nettó fedezet</span><span><b>{input.peers.medF2 == null ? "–" : ft(input.peers.medF2)}</b>{r.vsPeersMargin != null && <> · ez <b className={r.vsPeersMargin >= 0 ? "pos" : "neg"}>{sft(r.vsPeersMargin)}</b></>}</span></div>
            <div className="am-kv"><span>Medián állásidő</span><span><b>{input.peers.medDays == null ? "–" : `${Math.round(input.peers.medDays)} nap`}</b>{r.vsPeersDays != null && <> · ez <b className={r.vsPeersDays > 0 ? "neg" : "pos"}>{r.vsPeersDays > 0 ? "+" : ""}{Math.round(r.vsPeersDays)} nap</b></>}</span></div>
          </div>
        </div>
      </div>

      <div className="am-row">
        <div className="card am-water">
          <h2>Miből áll a(z) {ft(r.price)}?</h2>
          {water.map((w, i) => (
            <div key={i} className="am-wrow"><span>{w.label}</span><div className="am-wbar"><div style={{ left: `${w.left}%`, width: `${w.width}%`, background: WATER_COLOR[w.kind] }} /></div><span className="num">{ft(w.amount)}</span></div>
          ))}
          {meta.eprNote && <p className="muted am-note">{meta.eprNote}</p>}
          {!input.costs.length && <p className="muted am-note">Még nincs a gépkocsihoz rendelt költség.</p>}
        </div>
        <div className="card am-hold">
          <h2>Tartási költség</h2>
          <form action={saveHolding} className="am-hold-form">
            <input type="hidden" name="cid" value={cid} /><input type="hidden" name="vehicle" value={meta.vehicleId} />
            <label>Lekötött pénz költsége<span><input name="rate" className="num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canWrite} />%/év</span></label>
            <label>Fix napi költség (biztosítás, parkoló, hirdetés)<span><input name="fix" className="num" inputMode="numeric" value={fix} onChange={(e) => setFix(e.target.value)} disabled={!canWrite} />Ft/nap</span></label>
            <div className="am-hold-sum">
              <div><span>Lekötött pénz</span><b>{ft(r.capital)}</b></div>
              <div><span>Napi tartási költség</span><b>{ft(r.holdingPerDay)}</b></div>
              <div><span>{sold ? "Az állás alatt összesen" : "Eddig összesen"} ({r.days ?? 0} nap)</span><b>{ft(r.holding)}</b></div>
              <div><span>Fedezet tartási költséggel</span><b className={r.f3 >= 0 ? "pos" : "neg"}>{ft(r.f3)}</b></div>
              {!sold && <div><span>A nullszaldó naponta emelkedik</span><b>{ft(r.creep)}</b></div>}
            </div>
            {canWrite && changed && <button className="primary no-print">Mentés a cég alapértékeként</button>}
            <p className="muted am-note">A tartási költség becslés, nem könyvelt költség: a nettó fedezetet nem csökkenti, csak a nullszaldót, a figyelmeztetést és ezt a sort. Cégenként egy beállítás.</p>
          </form>
        </div>
      </div>

      {meta.checks.some((c) => !c.ok) && (
        <div className="card am-checks"><h2>Ellenőrzés (karton)</h2><ul>{meta.checks.filter((c) => !c.ok).map((c, i) => <li key={i} className="neg">{c.text}</li>)}</ul></div>
      )}
      <p className="muted am-foot">Mogyorosi Holding™ · AutóMérleg · {sold ? "lezárt elszámolás" : `élő számok, ${hu(input.today)}`} · célfedezet {r.targetFromHistory ? `${ft(r.target)} (eladott autók mediánja)` : `${ft(r.target)} (bekerülés 10%-a)`}</p>
    </div>
  );
}
