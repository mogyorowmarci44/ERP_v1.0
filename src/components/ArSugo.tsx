"use client";
/** ÁrSugó – „B: Ársáv” elrendezés: felül a bevitel, középen a javasolt hirdetési ár, alatta ársáv és próbaár csúszka. */
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { arsugo, pricePoint, HAGGLE, type VatMode } from "@/lib/arsugo";
import { fmtHuf } from "@/lib/money";

type Cost = { id: number; name: string; amount: number };

const parseFt = (v: string) => Number(v.replace(/[^0-9]/g, "")) || 0;
const ft = (n: number) => `${fmtHuf(n)} Ft`;
const pctTxt = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

function Seg({ value, onChange, label }: { value: VatMode; onChange: (v: VatMode) => void; label: string }) {
  return (
    <div className="as-seg" role="group" aria-label={label}>
      <button type="button" className={value === "margin" ? "on" : undefined} aria-pressed={value === "margin"} onClick={() => onChange("margin")}>Különbözeti</button>
      <button type="button" className={value === "normal" ? "on" : undefined} aria-pressed={value === "normal"} onClick={() => onChange("normal")}>Normál ÁFA</button>
    </div>
  );
}

export function ArSugo({ medianMargin, soldCount }: { medianMargin: number | null; soldCount: number }) {
  const [buy, setBuy] = useState(0);
  const [buyMode, setBuyMode] = useState<VatMode>("margin");
  const [sellMode, setSellMode] = useState<VatMode>("margin");
  const [costs, setCosts] = useState<Cost[]>([
    { id: 1, name: "Fényezés", amount: 0 },
    { id: 2, name: "Szerviz", amount: 0 },
  ]);
  const [nextId, setNextId] = useState(3);
  const [showCosts, setShowCosts] = useState(true);
  const [trial, setTrial] = useState<number | null>(null);

  const costTotal = costs.reduce((a, c) => a + c.amount, 0);
  const r = useMemo(() => arsugo({ buy, buyMode, sellMode, costs: costTotal, target: medianMargin }), [buy, buyMode, sellMode, costTotal, medianMargin]);
  const ready = buy > 0;

  // ársáv: a padló (vagy a beszerzés) alól a hirdetési ár fölé
  const lo = Math.floor((Math.min(r.buyCover, r.floor.price) * 0.9) / 10000) * 10000;
  const hi = Math.max(lo + 10000, Math.ceil((r.ask.price * 1.1) / 10000) * 10000);
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const tp = trial ?? r.ask.price;
  const t = pricePoint({ price: tp, buy, buyBase: r.buyBase, costs: costTotal, sellMode: r.sellMode });
  const zone = tp < r.buyCover ? "neg" : tp < r.floor.price ? "warn" : "pos";
  const zoneTxt = zone === "neg" ? "A beszerzési árat sem fedezi" : zone === "warn" ? "Veszteséges – a költségek és az ÁFA nincs fedezve" : tp < r.goal.price ? "Nyereséges, de a cél alatt" : "Nyereséges";

  const reset = () => setTrial(null);
  const setCost = (id: number, patch: Partial<Cost>) => { setCosts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))); reset(); };

  return (
    <div className="as">
      <div className="card as-inputs">
        <label className="as-field">
          <span>Beszerzési ár{buyMode === "normal" ? " (bruttó)" : ""}</span>
          <span className="as-money">
            <input inputMode="numeric" value={buy ? fmtHuf(buy) : ""} placeholder="0" onChange={(e) => { setBuy(parseFt(e.target.value)); reset(); }} autoFocus />
            <span>Ft</span>
          </span>
        </label>
        <div className="as-field">
          <span>Vétel ÁFA</span>
          <Seg label="Vétel ÁFA" value={buyMode} onChange={(v) => { setBuyMode(v); reset(); }} />
        </div>
        <div className="as-field">
          <span>Tervezett költségek (nettó)</span>
          <span className="as-money">
            <strong>{fmtHuf(costTotal)}</strong><span>Ft</span>
            <button type="button" className="as-link" onClick={() => setShowCosts((s) => !s)} aria-expanded={showCosts}>{showCosts ? "Bezár" : "Tételek"}</button>
          </span>
        </div>
        <div className="as-field">
          <span>Eladás ÁFA</span>
          <Seg label="Eladás ÁFA" value={r.sellMode} onChange={(v) => { setSellMode(v); reset(); }} />
        </div>

        {showCosts && (
          <div className="as-costs">
            {costs.map((c) => (
              <div key={c.id} className="as-cost">
                <input aria-label="Költség megnevezése" value={c.name} placeholder="Új tétel" onChange={(e) => setCost(c.id, { name: e.target.value })} autoFocus={!c.name} />
                <input aria-label={`${c.name || "Új tétel"} összege`} className="num" inputMode="numeric" value={c.amount ? fmtHuf(c.amount) : ""} placeholder="0" onChange={(e) => setCost(c.id, { amount: parseFt(e.target.value) })} />
                <button type="button" className="as-icon" aria-label={`${c.name || "Új tétel"} törlése`} onClick={() => { setCosts((cs) => cs.filter((x) => x.id !== c.id)); reset(); }}><X size={16} /></button>
              </div>
            ))}
            <div><button type="button" className="as-add" onClick={() => { setCosts((cs) => [...cs, { id: nextId, name: "", amount: 0 }]); setNextId((n) => n + 1); }}>+ Tétel</button></div>
          </div>
        )}
        {buyMode === "normal" && ready && (
          <div className="as-note">Levonható beszerzési ÁFA: {ft(r.buyVat)} · nettó bekerülés: {ft(r.buyBase)}</div>
        )}
        {r.invalidCombo && (
          <div className="as-warn">Levont ÁFÁ-jú vétel után nem lehet különbözeti eladás, ezért normál ÁFÁ-val számolok.</div>
        )}
      </div>

      <div className="card as-main">
        {!ready ? (
          <p className="muted as-empty">Írd be a beszerzési árat és a tervezett költségeket, és az ÁrSugó kiszámolja a padló, a cél és a hirdetési árat.</p>
        ) : (
          <>
            <div className="as-hero">
              <div className="muted">Javasolt hirdetési ár</div>
              <div className="as-big">{ft(r.ask.price)}</div>
              <div className="muted">Fedezet {ft(r.ask.margin)} ({pctTxt(r.ask.marginPct)}) · ÁFA {ft(r.ask.vat)}</div>
            </div>

            <div className="as-scale">
              <div className="as-labels">
                <div style={{ left: pos(r.goal.price) }}><b className="pos">Cél</b><span>{ft(r.goal.price)}</span></div>
                <div style={{ left: pos(r.ask.price) }}><b className="as-accent">Hirdetési</b><span>{ft(r.ask.price)}</span></div>
              </div>
              <div className="as-band">
                <div className="z-neg" style={{ width: pos(r.buyCover) }} />
                <div className="z-warn" style={{ left: pos(r.buyCover), right: `calc(100% - ${pos(r.floor.price)})` }} />
                <i className="m-neg" style={{ left: pos(r.buyCover) }} />
                <i className="m-warn" style={{ left: pos(r.floor.price) }} />
                <i className="m-pos" style={{ left: pos(r.goal.price) }} />
                <i className="m-acc" style={{ left: pos(r.ask.price) }} />
              </div>
              <div className="as-labels below">
                <div style={{ left: pos(r.buyCover) }}><b className="neg">Beszerzés</b><span>{ft(r.buyCover)}</span></div>
                <div style={{ left: pos(r.floor.price) }}><b className="warn">Nullszaldó</b><span>{ft(r.floor.price)}</span></div>
              </div>
              <div className="as-legend muted">
                <span><i className="l-neg" />beszerzési ár alatt</span>
                <span><i className="l-warn" />költségek + ÁFA még nincs fedezve</span>
                <span><i className="l-pos" />profit</span>
              </div>
              <input type="range" aria-label="Próbaár" min={lo} max={hi} step={1000} value={tp} onChange={(e) => setTrial(Number(e.target.value))} />
              <div className="as-ends muted"><span>{ft(lo)}</span><span>{ft(hi)}</span></div>
            </div>

            <div className="as-trial">
              <div><span>Próbaár</span><strong>{ft(tp)}</strong></div>
              <div><span>Fedezet</span><strong className={zone}>{ft(t.margin)}</strong></div>
              <div><span>Fedezet %</span><strong>{pctTxt(t.marginPct)}</strong></div>
              <div><span>ÁFA</span><strong>{ft(t.vat)}</strong></div>
              <div className="as-zone"><strong className={zone}>{zoneTxt}</strong><button type="button" onClick={reset} disabled={trial == null}>Vissza a javasolthoz</button></div>
            </div>
          </>
        )}
        <p className="muted as-foot">
          Célfedezet: <b>{ft(r.target)}</b>{" "}
          {r.targetFromHistory
            ? `– az elmúlt 12 hónapban eladott ${soldCount} autó medián fedezete (nettó árbevétel − teljes bekerülés).`
            : "– még nincs eladott autó, ezért a bekerülés 10%-a."}
          {" "}Nullszaldó: 0 fedezet · Cél: célfedezettel · Hirdetési: cél + {Math.round(HAGGLE * 100)}% alkuráhagyás, a legközelebbi …49 000 / …99 000 árra kerekítve ·{" "}
          {r.sellMode === "margin" ? "ÁFA = (eladási ár − beszerzési ár) × 27/127" : "ÁFA = eladási ár × 27/127"}
        </p>
      </div>
    </div>
  );
}
