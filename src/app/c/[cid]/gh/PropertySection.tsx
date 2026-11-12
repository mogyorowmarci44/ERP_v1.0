/** v2.0 – Megtérülés oldal: ingatlan piaci értéke (választható módszer) és „mi lenne, ha ma eladnám”. */
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import type { propertyReturn } from "@/lib/guesthouse";
import {
  GALLERY_WEIGHT,
  HPI_SOURCE,
  METHOD_WEIGHTS,
  PROPERTY_DEFAULTS,
  SALE_DEFAULTS,
  SALE_METHOD_LABEL,
  SALE_SZJA,
  TERRACE_WEIGHT,
  type SaleMethod,
} from "@/lib/valuation";
import { fmtNum, fmtPct } from "@/lib/gh-view";
import { savePropertyAction, setValuationMethodAction } from "./actions";

type PR = NonNullable<ReturnType<typeof propertyReturn>>;
const M = (x: number) => `${fmtNum(x / 1e6, 2)} M Ft`;
const sign = (x: number) => (x >= 0 ? "+" : "−") + fmtNum(Math.abs(x) / 1e6, 2);

export function PropertySection({ cid, view, pr, base, t0, asOf }: { cid: number; view: string; pr: PR; base: number; t0: string; asOf: string }) {
  const { v, prop, sale, summary: s } = pr;
  const priceM2 = prop.priceM2 ?? PROPERTY_DEFAULTS.priceM2;
  const cap = prop.capRate ?? PROPERTY_DEFAULTS.capRate;
  const n = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  const methods: Array<[SaleMethod, number | null, string, string]> = [
    ["comparable", v.comparable, `${fmtPct(METHOD_WEIGHTS.comparable)} súllyal`, v.area > 0 ? `${fmtNum(v.area, 1)} súlyozott m² × ${fmtHuf(priceM2)} Ft/m²${prop.equipmentValue ? ` + ${fmtHuf(prop.equipmentValue)} Ft berendezés` : ""}` : "add meg az alapterületet"],
    ["income", v.income, `${fmtPct(METHOD_WEIGHTS.income)} súllyal`, `${fmtHuf(v.noi)} Ft éves működési pénzáram (utolsó 12 hó, tételes adó nélkül) / ${fmtPct(cap, 1)} tőkésítési ráta`],
    ["indexed", v.indexed, `${fmtPct(METHOD_WEIGHTS.indexed)} súllyal`, `${fmtHuf(pr.purchase)} Ft vételár × ${fmtNum(v.hpiFactor, 3)} (${HPI_SOURCE})`],
    ["blend", v.value, "100%", "a három módszer súlyozott átlaga"],
  ];
  const kind = prop.kind ?? SALE_DEFAULTS.kind;
  const years = Number(asOf.slice(0, 4)) - Number(t0.slice(0, 4));

  return (
    <section id="piaci-ertek" style={{ marginBottom: 22 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", margin: "6px 0 10px" }}>
        <h2 style={{ margin: 0 }}>Ingatlan piaci értéke{prop.address ? ` – ${prop.address}` : ""}{prop.hrsz ? ` (${prop.hrsz} hrsz)` : ""}</h2>
        <form action={setValuationMethodAction} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="cid" value={cid} />
          <input type="hidden" name="g" value={view} />
          <span className="muted" style={{ fontSize: 13 }}>Eladási ár ez alapján:</span>
          <div className="segmented">
            {(Object.keys(SALE_METHOD_LABEL) as SaleMethod[]).map((m) => (
              <button key={m} name="method" value={m} className={pr.method === m ? "on" : ""} aria-pressed={pr.method === m}>{SALE_METHOD_LABEL[m]}</button>
            ))}
          </div>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Módszer</th><th className="num">Becsült érték</th><th className="num">Súly a súlyozottban</th><th>Számítás</th></tr></thead>
          <tbody>
            {methods.map(([m, val, w, how]) => (
              <tr key={m} style={pr.method === m ? { background: "var(--accent-soft)", fontWeight: 600 } : undefined}>
                <td>{pr.method === m ? "▸ " : ""}{SALE_METHOD_LABEL[m]}</td>
                <td className="num">{val === null ? "–" : `${fmtHuf(val)} Ft`}</td>
                <td className="num">{w}</td>
                <td className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>Mi lenne, ha ma eladnám? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>– {SALE_METHOD_LABEL[pr.method]} érték alapján, {fmtDate(asOf)}</span></h2>
      <div className="grid cols-4">
        <div className="card kpi">
          <div className="label">Nettó eladási bevétel (költségek és SZJA után)</div>
          <div className="value">{fmtNum(sale.net / 1e6, 1)}<small>M Ft</small></div>
          <div className="hint">eladási ár {M(sale.price)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Teljes nyereség a vásárlás óta</div>
          <div className={`value ${pr.totalNominal < 0 ? "neg" : "pos"}`}>{sign(pr.totalNominal)}<small>M Ft</small></div>
          <div className="hint">reálértéken (2021. szept. forintban): {sign(pr.totalReal)} M Ft</div>
        </div>
        <div className="card kpi">
          <div className="label">Visszakapott / befektetett</div>
          <div className="value">{fmtNum(pr.multiple, 2)}<small>×</small></div>
          <div className="hint">{M(s.cumNominal + sale.net)} a {M(base)} befektetésre</div>
        </div>
        <div className="card kpi">
          <div className="label">Éves hozam (IRR), {years} év</div>
          <div className="value">{fmtPct(pr.irrNominal, 1)}<small>nominális</small></div>
          <div className="hint">infláció felett (reál): {fmtPct(pr.irrReal, 1)} / év</div>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="statement">
          <thead><tr><th>Levezetés</th><th className="num">Ft</th></tr></thead>
          <tbody>
            <tr><td>Eladási ár ({SALE_METHOD_LABEL[pr.method].toLowerCase()})</td><td className="num">{fmtHuf(sale.price)}</td></tr>
            <tr><td className="indent-1">Ingatlanközvetítő díja ({fmtPct(prop.agentPct ?? SALE_DEFAULTS.agentPct, 1)} + 27% ÁFA)</td><td className="num neg">−{fmtHuf(sale.agentFee)}</td></tr>
            <tr><td className="indent-1">Egyéb eladási költség (ügyvéd, energetikai tanúsítvány, hirdetés)</td><td className="num neg">−{fmtHuf(sale.otherCosts)}</td></tr>
            <tr><td className="indent-1">
              SZJA ({fmtPct(SALE_SZJA)} × {fmtPct(sale.share)} × {fmtHuf(sale.income)} Ft jövedelem) –{" "}
              {kind === "residential" ? "lakóingatlan" : "egyéb ingatlan"}, a szerzést követő {years}. év{sale.share === 0 ? ": adómentes" : ""}
            </td><td className={`num${sale.szja ? " neg" : ""}`}>{sale.szja ? `−${fmtHuf(sale.szja)}` : "0"}</td></tr>
            <tr className="k-subtotal"><td>Nettó eladási bevétel</td><td className="num">{fmtHuf(sale.net)}</td></tr>
            <tr><td className="indent-1">+ Működésből eddig befolyt nettó pénzáram</td><td className="num">{fmtHuf(s.cumNominal)}</td></tr>
            <tr><td className="indent-1">− Vételár + illeték ({fmtDate(t0)})</td><td className="num neg">−{fmtHuf(base)}</td></tr>
            <tr className="k-total"><td>Teljes nyereség (nominális)</td><td className="num">{fmtHuf(pr.totalNominal)}</td></tr>
            <tr className="sub"><td>Ugyanez reálértéken (minden tétel 2021. szeptemberi forintban)</td><td className="num">{fmtHuf(pr.totalReal)}</td></tr>
            <tr className="sub"><td>Ebből az ingatlan értékváltozása (eladási ár − vételár − illeték)</td><td className="num">{fmtHuf(pr.gainNominal)} ({fmtPct(pr.gainNominal / base)}); reál: {fmtHuf(pr.gainReal)}</td></tr>
          </tbody>
        </table>
      </div>

      <details className="card" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ingatlan adatai, értékbecslési és eladási feltevések</summary>
        <form action={savePropertyAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="cid" value={cid} />
          <input type="hidden" name="g" value={view} />
          <div className="form-grid">
            <label>Cím<input name="address" defaultValue={prop.address ?? ""} /></label>
            <label>Helyrajzi szám<input name="hrsz" defaultValue={prop.hrsz ?? ""} /></label>
            <label>Telek (m²)<input name="plotM2" className="num" defaultValue={n(prop.plotM2)} /></label>
            <label>Alapterület (m²)<input name="floorM2" className="num" defaultValue={n(prop.floorM2)} /></label>
            <label>Galéria (m²) – {fmtPct(GALLERY_WEIGHT)} súllyal<input name="galleryM2" className="num" defaultValue={n(prop.galleryM2)} placeholder="pl. 15" /></label>
            <label>Fedett terasz (m²) – {fmtPct(TERRACE_WEIGHT)} súllyal<input name="terraceM2" className="num" defaultValue={n(prop.terraceM2)} /></label>
            <label>Fajlagos ár (Ft / súlyozott m²)<input name="priceM2" className="num" defaultValue={n(prop.priceM2)} placeholder={fmtHuf(PROPERTY_DEFAULTS.priceM2)} /></label>
            <label>Tőkésítési ráta (%)<input name="capRate" className="num" defaultValue={prop.capRate ? String(+(prop.capRate * 100).toFixed(2)) : ""} placeholder={String(PROPERTY_DEFAULTS.capRate * 100)} /></label>
            <label>Berendezés, dézsa jelenlegi értéke (Ft)<input name="equipmentValue" className="num" defaultValue={n(prop.equipmentValue)} placeholder="0" /></label>
            <label>Ingatlan típusa (adózás)
              <select name="kind" defaultValue={kind}>
                <option value="residential">Lakóingatlan (5 év után adómentes)</option>
                <option value="other">Egyéb – pl. zártkert, „kivett gazdasági épület” (15 éves sáv)</option>
              </select>
            </label>
            <label>Közvetítői díj (%, ÁFA nélkül)<input name="agentPct" className="num" defaultValue={prop.agentPct !== null && prop.agentPct !== undefined ? String(+(prop.agentPct * 100).toFixed(2)) : ""} placeholder={String(SALE_DEFAULTS.agentPct * 100)} /></label>
            <label>Egyéb eladási költség (Ft)<input name="otherSaleCosts" className="num" defaultValue={n(prop.otherSaleCosts)} placeholder={fmtHuf(SALE_DEFAULTS.otherSaleCosts)} /></label>
            <label>Értéknövelő beruházások (Ft, számlával)<input name="improvements" className="num" defaultValue={n(prop.improvements)} placeholder="0" /></label>
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="primary">Mentés</button><span className="muted" style={{ fontSize: 12.5 }}>Magánértékesítés nélkül közvetítő: írd a díjat 0-ra.</span></div>
        </form>
        <p className="muted" style={{ fontSize: 12.5 }}>
          A {fmtHuf(PROPERTY_DEFAULTS.priceM2)} Ft/m²-es alapérték szigetvári kínálati árakból becsült (felújított téglaépítésű zártkerti házak kb. 220–250 ezer, belvárosi felújított családi házak 380–575 ezer Ft/m²);
          a 9%-os tőkésítési ráta egy kisvárosi, egyszobás, rövid távú kiadású ingatlan kockázatát tükrözi. Az SZJA a Szja tv. 62. §-a szerint: lakóingatlannál a szerzés évét követő 5. évtől adómentes,
          egyéb ingatlannál a 6. évtől évente 10 százalékponttal csökken. Hogy az ingatlan lakóingatlannak minősül-e, a tulajdoni lap szerinti művelési ág / megnevezés dönti el (pl. „kivett lakóház, udvar”).
          A becslés tájékoztató jellegű, nem helyettesíti az értékbecslő és az adótanácsadó véleményét.
        </p>
      </details>
    </section>
  );
}
