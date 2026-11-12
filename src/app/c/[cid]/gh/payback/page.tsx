/** v2.0 – Megtérülés: a vételár + illeték diszkontált megtérülése havi / negyedéves / éves / kezdettől nézetben. */
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate, PNL_INCLUDE_LABEL } from "@/lib/entity";
import { fmtDate } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";
import { loadGuesthouse, propertyReturn } from "@/lib/guesthouse";
import { PropertySection } from "../PropertySection";
import { CF_LINES, cfOf, paybackFlows, paybackSummary, periodKey, periodKeys, periodLabel, type Gran } from "@/lib/gh-calc";
import { fmtPct } from "@/lib/gh-view";
import { Flash } from "@/components/Flash";
import { IncludeToggle, LineChart, Meter, Seg } from "@/components/gh/GhUi";
import { saveDiscountRateAction } from "../actions";
import { CPI_FORECAST, CPI_LAST_ACTUAL, cumulativeInflation } from "@/lib/cpi";

type View = Exclude<Gran, "week"> | "ltd";
const VIEW_LABEL: Record<View, string> = { month: "Havi", quarter: "Negyedéves", year: "Éves", ltd: "Kezdettől (LTD)" };

export default async function PaybackPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();
  const d = await loadGuesthouse(cid, company.taxProfile);
  const view: View = (["month", "quarter", "year", "ltd"] as View[]).includes(sp.g as View) ? (sp.g as View) : "year";
  const base = `/c/${cid}/gh/payback`;

  if (!d.t0 || d.base <= 0) {
    return (
      <div className="gh">
        <h1>Megtérülés</h1>
        <p className="muted">Nincs ingatlan bekerülési érték a könyvekben (12x számla – vételár, illeték). Az ingatlanvásárlást az import vagy egy vegyes tétel (T 1221 / K 4191) rögzíti.</p>
      </div>
    );
  }
  const t0 = d.t0;
  const flows = paybackFlows(d.days, d.include, t0, d.df, d.asOf);
  const s = paybackSummary(flows, d.base, d.df, d.asOf);
  const infl = cumulativeInflation(t0.slice(0, 7), CPI_LAST_ACTUAL, d.longRun);
  const pr = propertyReturn(d);

  // időszakos tábla
  const g: Gran = view === "ltd" ? "year" : view;
  const keys = periodKeys(t0, d.asOf, g);
  const per = new Map<string, { n: number; dsc: number }>(keys.map((k) => [k, { n: 0, dsc: 0 }]));
  for (const f of flows) {
    const p = per.get(periodKey(f.date, g));
    if (p) { p.n += f.nominal; p.dsc += f.discounted; }
  }
  let cn = 0, cd = 0;
  const rows = keys.map((k) => {
    const p = per.get(k)!;
    cn += p.n;
    cd += p.dsc;
    return { key: k, label: periodLabel(k, g), n: p.n, dsc: p.dsc, cn, cd, pct: cd / d.base, left: Math.max(0, d.base - cd) };
  });

  // havi halmozott görbe
  const mk = periodKeys(t0, d.asOf, "month");
  const pm = new Map(mk.map((k) => [k, { n: 0, dsc: 0 }]));
  for (const f of flows) {
    const p = pm.get(f.date.slice(0, 7));
    if (p) { p.n += f.nominal; p.dsc += f.discounted; }
  }
  let a = 0, b = 0;
  const nomPts: Array<{ label: string; value: number }> = [], dscPts: Array<{ label: string; value: number }> = [];
  for (const k of mk) {
    const p = pm.get(k)!;
    a += p.n; b += p.dsc;
    nomPts.push({ label: k.replace("-", ". "), value: a });
    dscPts.push({ label: k.replace("-", ". "), value: b });
  }

  // kezdettől: kategóriánként (nominális és diszkontált)
  const cat = new Map<string, { n: number; dsc: number }>();
  const addCat = (k: string, n: number, date: string) => {
    const c = cat.get(k) ?? { n: 0, dsc: 0 };
    c.n += n;
    c.dsc += n * d.df(date);
    cat.set(k, c);
  };
  for (const day of d.days) {
    if (day.date < t0 || day.date > d.asOf) continue;
    const c = cfOf(day.v, d.include);
    for (const l of c.lines) if (l.amount) addCat(l.key, l.amount, day.date);
    if (c.flat) addCat("t_flat", c.flat, day.date);
    if (c.tfh) addCat("t_tfh", c.tfh, day.date);
    if (c.ifa) addCat("t_ifa", c.ifa, day.date);
    if (c.invOther) addCat("inv_other", c.invOther, day.date);
  }
  const catLabel = new Map<string, string>([...CF_LINES, ["t_flat", "Tételes adó (számított)"], ["t_tfh", "TFH (számított)"], ["t_ifa", "IFA (számított)"], ["inv_other", "Egyéb tárgyi eszköz"]]);

  const projected = (x: string | null, reached: string | null) => (reached ? `elérve: ${fmtDate(reached)}` : x ? `várhatóan ${x.slice(0, 4)}. ${x.slice(5, 7)}. hó` : "a mostani tempóval nem térül meg");
  const yearsFrom = (x: string | null) => (x ? ((Date.parse(x) - Date.parse(t0)) / 86400000 / 365.25).toFixed(1).replace(".", ",") : null);

  return (
    <div className="gh">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="topbar">
        <div>
          <h1>Megtérülés</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>A vételár + illeték ({fmtHuf(d.base)} Ft, {fmtDate(t0)}) megtérülése a vásárlás óta befolyt nettó pénzáramból, a KSH havi inflációjával a vásárláskori forintra diszkontálva. Infláció {fmtDate(t0).slice(0, 8)} – {CPI_LAST_ACTUAL.replace("-", ". ")}.: {fmtPct(infl, 1)}.</div>
        </div>
        <Seg items={(["month", "quarter", "year", "ltd"] as View[]).map((v) => ({ href: `${base}?g=${v}`, label: VIEW_LABEL[v], on: view === v }))} />
      </div>

      {pr ? <PropertySection cid={cid} view={view} pr={pr} base={d.base} t0={t0} asOf={d.asOf} /> : null}

      <h2>Megtérülés a működésből</h2>
      <div className="grid cols-4">
        <div className="card kpi">
          <div className="label">Megtérült (reálértéken, 2021-es forintban)</div>
          <div className="value">{fmtPct(s.recoveredPct, 1)}<small>· {fmtHuf(s.cumDiscounted)} Ft</small></div>
          <Meter pct={s.recoveredPct} label="Diszkontált megtérülés" />
          <div className="hint">hátravan: {fmtHuf(Math.max(0, d.base - s.cumDiscounted))} Ft (a vásárláskori értéken)</div>
        </div>
        <div className="card kpi">
          <div className="label">Megtérült (nominális)</div>
          <div className="value">{fmtPct(s.recoveredPctNominal, 1)}<small>· {fmtHuf(s.cumNominal)} Ft</small></div>
          <Meter pct={s.recoveredPctNominal} label="Nominális megtérülés" />
          <div className="hint">hátravan: {fmtHuf(Math.max(0, d.base - s.cumNominal))} Ft</div>
        </div>
        <div className="card kpi">
          <div className="label">Megtérülési idő reálértéken</div>
          <div className="value" style={{ fontSize: 20 }}>{projected(s.projectedDiscounted, s.reachedDiscounted)}</div>
          <div className="hint">{yearsFrom(s.projectedDiscounted) ? `${yearsFrom(s.projectedDiscounted)} év a vásárlástól · ` : ""}nominálisan: {projected(s.projectedNominal, s.reachedNominal)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Reálérték-egyenleg eddig (NPV)</div>
          <div className={`value ${s.npv < 0 ? "neg" : "pos"}`}>{fmtHuf(s.npv)}<small>Ft</small></div>
          <div className="hint">utolsó 12 hónap pénzárama: {fmtHuf(s.ttm)} Ft ({fmtHuf(s.monthly)} Ft/hó) – erre épül az előrejelzés</div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "16px 0 8px" }}>
        <form action={saveDiscountRateAction} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="cid" value={cid} />
          <input type="hidden" name="g" value={view} />
          <span className="muted" style={{ fontSize: 12.5 }}>Előrejelzés (MNB, 2026. szept.): {Object.entries(CPI_FORECAST).map(([y, r]) => `${y}: ${fmtPct(r, 1)}`).join(" · ")} · utána</span>
          <input name="rate" className="num" aria-label="Hosszú távú infláció (%)" defaultValue={String(+(d.longRun * 100).toFixed(2)).replace(".", ",")} style={{ width: 64 }} />
          <span className="muted" style={{ fontSize: 12.5 }}>%/év</span>
          <button>Mentés</button>
        </form>
        <IncludeToggle cid={cid} inc={d.include} back={`${base}?g=${view}`} />
      </div>

      <div className="card">
        <LineChart
          title="Halmozott pénzáram a vásárlás óta, a vételárhoz mérve"
          series={[
            { name: "Halmozott reálértéken (2021. szept. forint)", color: "var(--ch-airbnb)", points: dscPts },
            { name: "Halmozott nominális pénzáram", color: "var(--ch-booking)", points: nomPts },
          ]}
          base={d.base}
          baseLabel={`Vételár + illeték (${fmtHuf(d.base)} Ft)`}
          height={260}
        />
      </div>

      {view === "ltd" ? (
        <>
          <h2>Kezdettől (LTD) – miből jött vissza a pénz</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tétel</th><th className="num">Nominális</th><th className="num">Reálértéken</th><th className="num">a vételár %-ában</th></tr></thead>
              <tbody>
                {[...cat.entries()].sort((x, y) => y[1].n - x[1].n).map(([k, v]) => (
                  <tr key={k}><td>{catLabel.get(k) ?? k}</td><td className={`num${v.n < 0 ? " neg" : ""}`}>{fmtHuf(v.n)}</td><td className={`num${v.dsc < 0 ? " neg" : ""}`}>{fmtHuf(v.dsc)}</td><td className="num">{fmtPct(v.dsc / d.base, 1)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Megtérült összesen</td><td className="num">{fmtHuf(s.cumNominal)}</td><td className="num">{fmtHuf(s.cumDiscounted)}</td><td className="num">{fmtPct(s.recoveredPct, 1)}</td></tr>
                <tr><td>Vételár + illeték</td><td className="num">{fmtHuf(-d.base)}</td><td className="num">{fmtHuf(-d.base)}</td><td className="num">−100%</td></tr>
                <tr><td>Egyenleg (NPV eddig)</td><td className="num">{fmtHuf(s.cumNominal - d.base)}</td><td className="num">{fmtHuf(s.npv)}</td><td className="num">{fmtPct(s.recoveredPct - 1, 1)}</td></tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <>
          <h2>{VIEW_LABEL[view]} megtérülés</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Időszak</th><th className="num">Pénzáram</th><th className="num">Reálértéken</th><th className="num">Halmozott (nominális)</th><th className="num">Halmozott (reálértéken)</th><th className="num">Megtérült</th><th className="num">Hátralévő</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className={`num${r.n < 0 ? " neg" : ""}`}>{fmtHuf(r.n)}</td>
                    <td className={`num${r.dsc < 0 ? " neg" : ""}`}>{fmtHuf(r.dsc)}</td>
                    <td className="num">{fmtHuf(r.cn)}</td>
                    <td className="num">{fmtHuf(r.cd)}</td>
                    <td className="num">{fmtPct(r.pct, 1)}</td>
                    <td className="num">{fmtHuf(r.left)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 12.5 }}>
        Pénzáram = minden tényleges befolyás és kiadás a vásárlás óta (a hosszú távú bérleti díj, a szállásdíjak, a költségek, az eszközbeszerzések pl. dézsa), plusz a számított adók esedékesség szerint (TFH/IFA: {PNL_INCLUDE_LABEL[d.include].toLowerCase()}); a vételár és az illeték maga a megtérülendő összeg.
        Diszkontálás: minden hónap pénzáramát a KSH fogyasztóiár-indexével (előző hónap = 100) a vásárlás hónapjának árszintjére számoljuk vissza; a még nem publikált hónapokra és az előrejelzésben az MNB inflációs pályája, utána a megadott hosszú távú ráta érvényes. Az ingatlan értéknövekedése (eladási ár) nincs benne – ez a működésből való megtérülés. Az előrejelzés az utolsó 12 hónap átlagos havi pénzáramával számol, az előrejelzett inflációval diszkontálva.
      </p>
    </div>
  );
}
