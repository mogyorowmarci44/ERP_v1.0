import { requireCompany } from "@/lib/auth";
import { calibrationFor, getForecastSettings } from "@/lib/forecast-data";
import { MIN_CALIBRATION_SALES, quantile } from "@/lib/forecast";
import { ForecastTabs } from "@/components/Forecast";
import { Flash } from "@/components/Flash";
import { saveScenarioSettingsAction, calibrateAction, resetScenarioAction } from "../actions";

const pct = (x: number) => Math.round(x * 1000) / 10;

export default async function ForecastSettingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const cal = await calibrationFor(cid);
  const s = await getForecastSettings(cid);
  const h = cal.history;
  const enough = h.length >= MIN_CALIBRATION_SALES;
  const q = (arr: number[], p: number) => quantile(arr, p);

  const Row = ({ label, name, value, unit, hint }: { label: string; name: string; value: number; unit: string; hint?: string }) => (
    <label>{label} ({unit})<input name={name} className="num" defaultValue={String(value)} disabled={!canWrite} />{hint && <small className="muted">{hint}</small>}</label>
  );

  return (
    <div className="viz-sc">
      <h1>Forecast</h1>
      <ForecastTabs cid={cid} active="settings" />
      <Flash error={sp.error} ok={sp.ok} />

      <p className="muted">
        Az <strong>alap</strong> forgatókönyv a te inputod (Készlet és Költségek fül). A <span className="sc-pessimistic"><span className="sc-dot" />rosszabb</span> és a{" "}
        <span className="sc-optimistic"><span className="sc-dot" />jobb</span> forgatókönyv ezekkel az eltérésekkel számolódik az alapból. A kimutatásban egy gombbal váltasz köztük.
        {s.calibratedFrom && <> Jelenlegi beállítás forrása: <strong>{s.calibratedFrom}</strong>.</>}
      </p>

      <form action={saveScenarioSettingsAction}>
        <input type="hidden" name="cid" value={cid} />
        <div className="grid cols-2">
          <div className="card sc-pessimistic">
            <h2 style={{ marginTop: 0 }}><span className="sc-dot" />Rosszabb</h2>
            <div className="form-grid">
              <Row label="Eladási ár" name="p_price" value={pct(s.pessimistic.priceAdj)} unit="%" hint="negatív = olcsóbban adjuk el" />
              <Row label="Eladás csúszása" name="p_days" value={s.pessimistic.dateShiftDays} unit="nap" hint="+ = később" />
              <Row label="Autós költségek" name="p_vcost" value={pct(s.pessimistic.vehicleCostAdj)} unit="%" />
              <Row label="Ismétlődő költségek" name="p_fixed" value={pct(s.pessimistic.fixedCostAdj)} unit="%" />
            </div>
          </div>
          <div className="card sc-optimistic">
            <h2 style={{ marginTop: 0 }}><span className="sc-dot" />Jobb</h2>
            <div className="form-grid">
              <Row label="Eladási ár" name="o_price" value={pct(s.optimistic.priceAdj)} unit="%" />
              <Row label="Eladás csúszása" name="o_days" value={s.optimistic.dateShiftDays} unit="nap" hint="− = korábban" />
              <Row label="Autós költségek" name="o_vcost" value={pct(s.optimistic.vehicleCostAdj)} unit="%" />
              <Row label="Ismétlődő költségek" name="o_fixed" value={pct(s.optimistic.fixedCostAdj)} unit="%" />
            </div>
          </div>
        </div>
        <div className="card form-grid" style={{ marginTop: 14 }}>
          <Row label="Tervezési horizont" name="horizon" value={s.horizonMonths} unit="hónap" hint="3–36, a folyó hónappal" />
          <Row label="Helyi iparűzési adó" name="hipa" value={pct(s.hipaRate)} unit="%" hint="a székhely szerinti önkormányzat mértéke" />
          <Row label="Társasági adó" name="tao" value={pct(s.taoRate)} unit="%" />
          {canWrite && <div style={{ alignSelf: "end" }}><button className="primary">Mentés</button></div>}
        </div>
      </form>

      <h2>Kalibrálás a múltbeli eladásokból</h2>
      <div className="card">
        {enough ? (
          <>
            <p style={{ marginTop: 0 }}>
              {h.length} lezárt eladás: a készleten töltött idő mediánja <strong>{Math.round(q(h.map((x) => x.holdingDays), 0.5))} nap</strong>
              {" "}(gyengébb negyed {Math.round(q(h.map((x) => x.holdingDays), 0.75))}, erősebb negyed {Math.round(q(h.map((x) => x.holdingDays), 0.25))} nap),
              a bruttó eladási ár a könyv szerinti érték mediánon <strong>{pct(q(h.map((x) => x.markup), 0.5) - 1)}%</strong>-kal felette
              {" "}(gyengébb negyed {pct(q(h.map((x) => x.markup), 0.25) - 1)}%, erősebb negyed {pct(q(h.map((x) => x.markup), 0.75) - 1)}%).
            </p>
            <p className="muted">
              Kalibráláskor a rosszabb forgatókönyv a gyengébb negyed, a jobb az erősebb negyed eltérését kapja a mediánhoz képest
              (ár: −15% és +10% közé korlátozva, csúszás: legfeljebb +120 / −60 nap). A költség-eltérések nem változnak.
              Javaslat: rosszabb {pct(cal.settings.pessimistic.priceAdj)}% / +{cal.settings.pessimistic.dateShiftDays} nap, jobb +{pct(cal.settings.optimistic.priceAdj)}% / {cal.settings.optimistic.dateShiftDays} nap.
            </p>
          </>
        ) : (
          <p style={{ marginTop: 0 }}>
            Még kevés a lezárt eladás ({h.length} db, legalább {MIN_CALIBRATION_SALES} kell), ezért a fix alapértékekkel számol
            (rosszabb: −5% ár, +30 nap, +20% autós és +10% ismétlődő költség; jobb: +3% ár, −14 nap, −10% autós költség).
          </p>
        )}
        {canWrite && (
          <div className="row">
            {enough && <form action={calibrateAction}><input type="hidden" name="cid" value={cid} /><button className="primary">Kalibrálás a múltbeli eladásokból</button></form>}
            <form action={resetScenarioAction}><input type="hidden" name="cid" value={cid} /><button>Alapértékek visszaállítása</button></form>
          </div>
        )}
      </div>
    </div>
  );
}
