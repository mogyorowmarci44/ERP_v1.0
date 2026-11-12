/** v2.0 – Megtérülés oldal: ingatlan piaci értéke és teljes hozam. */
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import type { propertyReturn } from "@/lib/guesthouse";
import { GALLERY_WEIGHT, HPI_SOURCE, METHOD_WEIGHTS, PROPERTY_DEFAULTS, TERRACE_WEIGHT } from "@/lib/valuation";
import { fmtNum, fmtPct } from "@/lib/gh-view";
import { savePropertyAction } from "./actions";

type PR = NonNullable<ReturnType<typeof propertyReturn>>;

export function PropertySection({ cid, view, pr, base, t0 }: { cid: number; view: string; pr: PR; base: number; t0: string }) {
  const { v, prop } = pr;
  const priceM2 = prop.priceM2 ?? PROPERTY_DEFAULTS.priceM2;
  const cap = prop.capRate ?? PROPERTY_DEFAULTS.capRate;
  const n = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  const rows: Array<[string, number | null, number, string]> = [
    ["Összehasonlító (piaci)", v.comparable, METHOD_WEIGHTS.comparable, v.area > 0 ? `${fmtNum(v.area, 1)} súlyozott m² × ${fmtHuf(priceM2)} Ft/m²${prop.equipmentValue ? ` + ${fmtHuf(prop.equipmentValue)} Ft berendezés` : ""}` : "add meg az alapterületet"],
    ["Hozamszámítás", v.income, METHOD_WEIGHTS.income, `${fmtHuf(v.noi)} Ft éves működési pénzáram (utolsó 12 hó, tételes adó nélkül) / ${fmtPct(cap, 1)} tőkésítési ráta`],
    ["Indexált vételár", v.indexed, METHOD_WEIGHTS.indexed, `${fmtHuf(pr.purchase)} Ft vételár × ${fmtNum(v.hpiFactor, 3)} (${HPI_SOURCE})`],
  ];
  return (
    <section id="piaci-ertek" style={{ marginBottom: 22 }}>
      <h2>Ingatlan piaci értéke{prop.address ? ` – ${prop.address}` : ""}{prop.hrsz ? ` (${prop.hrsz} hrsz)` : ""}</h2>
      <div className="grid cols-4">
        <div className="card kpi">
          <div className="label">Becsült piaci érték (ma)</div>
          <div className="value">{fmtNum(v.value / 1e6, 1)}<small>M Ft</small></div>
          <div className="hint">sáv: {fmtNum(v.low / 1e6, 1)} – {fmtNum(v.high / 1e6, 1)} M Ft (a három módszer szélső értékei)</div>
        </div>
        <div className="card kpi">
          <div className="label">Értéknövekedés a bekerülési értékhez ({fmtHuf(base)} Ft)</div>
          <div className={`value ${pr.gainNominal < 0 ? "neg" : "pos"}`}>{pr.gainNominal >= 0 ? "+" : ""}{fmtNum(pr.gainNominal / 1e6, 1)}<small>M Ft · {fmtPct(pr.gainNominal / base)}</small></div>
          <div className="hint">reálértéken: {pr.gainReal >= 0 ? "+" : ""}{fmtNum(pr.gainReal / 1e6, 1)} M Ft ({fmtPct(pr.gainReal / base)}), 2021. szeptemberi forintban</div>
        </div>
        <div className="card kpi">
          <div className="label">Teljes hozam eddig (pénzáram + piaci érték − befektetés)</div>
          <div className={`value ${pr.totalNominal < 0 ? "neg" : "pos"}`}>{pr.totalNominal >= 0 ? "+" : ""}{fmtNum(pr.totalNominal / 1e6, 1)}<small>M Ft · {fmtNum(pr.multiple, 2)}×</small></div>
          <div className="hint">reálértéken: {pr.totalReal >= 0 ? "+" : ""}{fmtNum(pr.totalReal / 1e6, 1)} M Ft · a befektetés {fmtNum(pr.multiple, 2)}-szorosa jött vissza / ér most</div>
        </div>
        <div className="card kpi">
          <div className="label">Éves hozam (IRR) {fmtDate(t0)} óta</div>
          <div className="value">{fmtPct(pr.irrNominal, 1)}<small>nominális</small></div>
          <div className="hint">reál (infláció felett): {fmtPct(pr.irrReal, 1)} / év – mintha ma eladnád a becsült értéken</div>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Módszer</th><th className="num">Érték</th><th className="num">Súly</th><th>Számítás</th></tr></thead>
          <tbody>
            {rows.map(([label, val, w, how]) => (
              <tr key={label}><td>{label}</td><td className="num">{val === null ? "–" : `${fmtHuf(val)} Ft`}</td><td className="num">{fmtPct(w)}</td><td className="muted" style={{ fontSize: 13 }}>{how}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>Súlyozott becslés</td><td className="num">{fmtHuf(v.value)} Ft</td><td className="num">100%</td><td></td></tr></tfoot>
        </table>
      </div>

      <details className="card" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ingatlan adatai és értékbecslési feltevések</summary>
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
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="primary">Mentés</button></div>
        </form>
        <p className="muted" style={{ fontSize: 12.5 }}>
          A {fmtHuf(PROPERTY_DEFAULTS.priceM2)} Ft/m²-es alapérték a szigetvári hirdetésekből becsült: felújított, téglaépítésű zártkerti házak kb. 220–250 ezer Ft/m², felújítandó hétvégi házak 110–170 ezer Ft/m²,
          belvárosi felújított családi házak 380–575 ezer Ft/m² (kínálati árak, 2026. november). Egy működő, felújított, dézsás vendégház ennél a zártkerti sávnál feljebb, a városi házak alatt helyezkedik el.
          A 9%-os tőkésítési ráta egy kisvárosi, egyszobás, rövid távú kiadású, személyes működtetést igénylő ingatlan kockázatát tükrözi. A zártkerti fekvés miatt a vevőkör szűkebb (jelzáloghitel nehezebben kapható) – ezt a fajlagos ár már tartalmazza.
          A becslés tájékoztató jellegű, nem helyettesíti az értékbecslő szakvéleményét.
        </p>
      </details>
    </section>
  );
}
