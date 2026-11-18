import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { companyKpis, type CompanyKpis } from "@/lib/kpi";
import { fmtHuf } from "@/lib/money";
import { fmtDate, addDaysIso, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const eFt = (n: number | null | undefined) => (n == null ? "–" : `${nf.format(Math.round(n / 1000) || 0)} eFt`);
const pct = (x: number | null | undefined) => (x == null ? "–" : `${(Math.round(x * 1000) / 10).toLocaleString("hu-HU")}%`);
const num = (x: number | null | undefined, d = 1, unit = "") => (x == null ? "–" : `${x.toLocaleString("hu-HU", { maximumFractionDigits: d })}${unit}`);
const MONTHS = ["jan", "feb", "már", "ápr", "máj", "jún", "júl", "aug", "szep", "okt", "nov", "dec"];

type Yoy = { cur: number | null | undefined; prev: number | null | undefined; mode: "pct" | "bps"; better: "up" | "down" | "neutral" };
type K = NonNullable<CompanyKpis>;

/** Tavalyi összevetés: összegeknél / darabnál / napoknál %-os változás, arányoknál bázispont (bps) különbség. */
function YoyLine({ y }: { y: Yoy }) {
  if (y.cur == null || y.prev == null || !Number.isFinite(y.cur) || !Number.isFinite(y.prev)) return <div className="kpi-yoy muted">tavaly: nincs adat</div>;
  const diff = y.cur - y.prev;
  let text: string;
  if (y.mode === "bps") {
    const bps = Math.round(diff * 10000);
    text = `${bps > 0 ? "+" : bps < 0 ? "−" : "±"}${nf.format(Math.abs(bps))} bps`;
  } else {
    if (y.prev === 0) return <div className="kpi-yoy muted">tavaly: 0 – nem összevethető</div>;
    const ch = diff / Math.abs(y.prev);
    text = `${ch > 0 ? "+" : ch < 0 ? "−" : "±"}${(Math.round(Math.abs(ch) * 1000) / 10).toLocaleString("hu-HU")}%`;
  }
  const good = y.better === "neutral" || Math.abs(diff) < 1e-9 ? null : (diff > 0) === (y.better === "up");
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "■";
  return <div className={`kpi-yoy${good === true ? " good" : good === false ? " bad" : ""}`}>{arrow} {text} <span className="muted">vs. tavaly</span></div>;
}

function Stat({ label, value, sub, tone, yoy }: { label: string; value: string; sub?: React.ReactNode; tone?: "neg" | "warn"; yoy?: Yoy | null }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value${tone === "neg" ? " neg" : ""}`} style={tone === "warn" ? { color: "var(--warn, #b45309)" } : undefined}>{value}</div>
      {yoy && <YoyLine y={yoy} />}
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}

export default async function KpiPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const yearAgo = addDaysIso(today(), -365);
  const [k0, p] = await Promise.all([companyKpis(cid), companyKpis(cid, yearAgo)]);
  const k = k0 as K;
  // tavalyi érték kiolvasása + összevetés – ha a cég egy éve még nem működött, nincs összevetés
  const Y = (f: (x: K) => number | null | undefined, mode: Yoy["mode"], better: Yoy["better"]): Yoy | null => (p ? { cur: f(k), prev: f(p), mode, better } : null);
  const b = `/c/${cid}`;
  const old90 = k.stock.buckets[3];
  const maxTrend = Math.max(1, ...k.ops.trend.map((m) => Math.max(m.bought, m.sold)));

  return (
    <div className="kpi">
      <div className="topbar">
        <div>
          <h1>KPI-Dashboard</h1>
          <span className="muted">
            {company.name} · {fmtDate(k.from)} – {fmtDate(k.asOf)}
            {k.partial ? ` (${num(k.months)} hónap adata – a cég még nem működik egy éve, a havi átlagok ennyi hónapra vetítve)` : " (elmúlt 12 hónap)"}
          </span>
          <div className="muted" style={{ fontSize: 13 }}>
            {p
              ? <>Összevetés: ugyanezek a mutatók egy évvel korábban ({fmtDate(p.from)} – {fmtDate(p.asOf)}{p.partial ? `, ${num(p.months)} hónap adata` : ""}). Összegek, darab és nap: % változás · arányok: bázispont (bps).</>
              : <>Tavalyi összevetés nincs: egy évvel ezelőtt ({fmtDate(yearAgo)}) a cégnek még nem volt könyvelése.</>}
          </div>
        </div>
      </div>

      <h2 className="kpi-h">Kiemelt mutatók</h2>
      <div className="grid cols-4 lp-kpi">
        <Stat yoy={Y((x) => x.turnover.medDaysAll, "pct", "down")} label="Állásidő (medián)" value={k.turnover.medDaysAll == null ? "–" : `${k.turnover.medDaysAll} nap`} sub={`mind a ${k.stock.everCount} valaha készleten volt autó`} />
        <Stat yoy={Y((x) => x.stock.buckets[3].count, "pct", "down")} label="90 napnál régebben álló autók" value={`${old90.count} db`} sub={eFt(old90.value)} tone={old90.count ? "warn" : undefined} />
        <Stat yoy={Y((x) => x.margin.medF2, "pct", "up")} label="Fedezet II / autó (medián)" value={eFt(k.margin.medF2)} sub="nettó árbevétel − teljes bekerülési érték" />
        <Stat yoy={Y((x) => x.margin.ratio, "bps", "up")} label="Fedezeti hányad" value={pct(k.margin.ratio)} sub="fedezet / nettó árbevétel" />
        <Stat yoy={Y((x) => x.margin.coverage, "bps", "up")} label="Fix költségek fedezettsége" value={pct(k.margin.coverage)} tone={k.margin.coverage != null && k.margin.coverage < 1 ? "neg" : undefined} sub="az autók fedezete a rezsi %-ában" />
        <Stat yoy={Y((x) => x.money.roc, "bps", "up")} label="Tőkearányos megtérülés" value={pct(k.money.roc)} sub="éves eredmény / átlagos készletbe kötött tőke" />
        <Stat yoy={Y((x) => x.turnover.soldCount / x.months, "pct", "up")} label="Havi eladott darabszám" value={num(k.turnover.soldCount / k.months)} sub={`${k.turnover.soldCount} db az időszakban`} />
        <Stat yoy={Y((x) => x.money.free, "pct", "up")} label="Szabad pénz" value={eFt(k.money.free)} tone={k.money.free < 0 ? "neg" : undefined} sub="pénz − szállítók − 1 havi fix költség" />
      </div>

      <section className="card kpi-sec">
        <h2>Készlet és forgás <span className="muted">– mind a {k.stock.everCount} valaha készleten volt autó, mediánnal ({k.turnover.histMonths} hónap)</span></h2>
        <div className="grid cols-4 lp-kpi">
          <Stat yoy={Y((x) => x.turnover.medDaysAll, "pct", "down")} label="Állásidő (medián)" value={k.turnover.medDaysAll == null ? "–" : `${k.turnover.medDaysAll} nap`}
            sub={<>eladott autók: {k.turnover.medDaysSold == null ? "–" : `${k.turnover.medDaysSold} nap`}; a készleten lévőknél a mai napig</>} />
          <Stat yoy={Y((x) => x.turnover.rateAll, "pct", "up")} label="Készletforgás" value={k.turnover.rateAll == null ? "–" : `${num(k.turnover.rateAll)}× / év`} sub={`${k.turnover.soldAll} eladott autó / medián készlet ${num(k.turnover.medStockCount)} db`} />
          <Stat yoy={Y((x) => x.stock.count, "pct", "neutral")} label="Készlet most" value={`${k.stock.count} db · ${eFt(k.stock.value)}`} sub={k.stock.monthsOfSales == null ? undefined : <>{num(k.stock.monthsOfSales)} havi eladásnak felel meg (medián {num(k.turnover.medSoldPerMonth)} db / hó)</>} />
          <Stat yoy={Y((x) => x.stock.medTiedAll, "pct", "neutral")} label="Lekötött tőke / autó (medián)" value={eFt(k.stock.medTiedAll)} sub={<>bekerülési érték, összes autó · a mostani készleten átlag {eFt(k.stock.avgTied)}</>} />
        </div>
        <div className="kpi-buckets">
          {k.stock.buckets.map((bk, i) => (
            <div key={bk.label} className={`kpi-bucket b${i}`}>
              <div className="muted">{bk.label}</div>
              <strong>{bk.count} db</strong> <span className="muted">· {eFt(bk.value)}</span>
            </div>
          ))}
        </div>
        {k.stock.cars.length > 0 && (
          <details className="fc-more">
            <summary>Készleten lévő autók állásidő szerint ({k.stock.cars.length} db)</summary>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Gépkocsi</th><th>Vétel</th><th className="num">Áll</th><th className="num">Lekötött tőke</th><th className="num">Terv szerinti ár</th></tr></thead>
                <tbody>
                  {k.stock.cars.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`${b}/vehicles/${c.id}`}>{c.label}</Link></td>
                      <td>{fmtDate(c.purchaseDate)}</td>
                      <td className={`num${c.age > 90 ? " neg" : ""}`}>{c.age} nap</td>
                      <td className="num">{fmtHuf(c.bookValue)}</td>
                      <td className="num">{c.planPrice ? fmtHuf(c.planPrice) : <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="card kpi-sec">
        <h2>Jövedelmezőség <span className="muted">– az időszakban eladott {k.turnover.soldCount} autó</span></h2>
        <div className="grid cols-4 lp-kpi">
          <Stat yoy={Y((x) => x.profit.avgGrossMargin, "pct", "up")} label="Átlagos bruttó árrés / autó" value={eFt(k.profit.avgGrossMargin)} sub="eladási ár (bruttó) − bekerülési érték" />
          <Stat yoy={Y((x) => x.profit.marginPct, "bps", "up")} label="Árrés %" value={pct(k.profit.marginPct)} sub="az eladási ár arányában" />
          <Stat yoy={Y((x) => x.profit.avgNetAfterOverhead, "pct", "up")} label="Nettó haszon / autó" value={eFt(k.profit.avgNetAfterOverhead)} tone={(k.profit.avgNetAfterOverhead ?? 0) < 0 ? "neg" : undefined}
            sub={<>különbözeti ÁFA nélkül {eFt(k.profit.avgNetBeforeOverhead)}, rezsi {eFt(k.profit.overheadPerCar)} / autó</>} />
          <Stat yoy={Y((x) => x.profit.refurbPct, "bps", "down")} label="Felújítási költség aránya" value={pct(k.profit.refurbPct)} sub="felújítás, fényezés, alkatrész a vételár %-ában" />
        </div>
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <div>
            <h3>Típusonként</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Típus</th><th className="num">db</th><th className="num">Árrés / autó</th><th className="num">Fedezet II (medián)</th><th className="num">Árrés %</th><th className="num">Állásidő (medián)</th></tr></thead>
                <tbody>
                  {k.profit.byModel.map((g) => (
                    <tr key={g.key}><td>{g.key}</td><td className="num">{g.count}</td><td className={`num${g.avgMargin < 0 ? " neg" : ""}`}>{eFt(g.avgMargin)}</td><td className={`num${(g.medF2 ?? 0) < 0 ? " neg" : ""}`}>{eFt(g.medF2)}</td><td className="num">{pct(g.marginPct)}</td><td className="num">{g.avgDays == null ? "–" : `${g.avgDays} nap`}</td></tr>
                  ))}
                  {!k.profit.byModel.length && <tr><td colSpan={6} className="muted">Nincs eladás az időszakban.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3>Beszerzési forrás szerint</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Forrás</th><th className="num">db</th><th className="num">Árrés / autó</th><th className="num">Fedezet II (medián)</th><th className="num">Árrés %</th><th className="num">Állásidő (medián)</th></tr></thead>
                <tbody>
                  {k.profit.byOrigin.map((g) => (
                    <tr key={g.key}><td>{g.key}</td><td className="num">{g.count}</td><td className={`num${g.avgMargin < 0 ? " neg" : ""}`}>{eFt(g.avgMargin)}</td><td className={`num${(g.medF2 ?? 0) < 0 ? " neg" : ""}`}>{eFt(g.medF2)}</td><td className="num">{pct(g.marginPct)}</td><td className="num">{g.avgDays == null ? "–" : `${g.avgDays} nap`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="card kpi-sec">
        <h2>Fedezet <span className="muted">– az időszakban eladott {k.margin.soldCount} autó</span></h2>
        <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
          <strong>Fedezet I</strong> = nettó árbevétel (különbözeti ÁFA nélkül) − vételár · <strong>Fedezet II</strong> = nettó árbevétel − teljes bekerülési érték (vételár + felújítás + egyéb közvetlen költség).
          A fedezetből kell kitermelni a rezsit (fix költségeket); ami fölötte marad, az a nyereség. Az autónkénti értékek mediánok.
        </p>
        <div className="grid cols-4 lp-kpi">
          <Stat yoy={Y((x) => x.margin.medF1, "pct", "up")} label="Fedezet I / autó (medián)" value={eFt(k.margin.medF1)} sub={`összesen ${eFt(k.margin.totalF1)}`} />
          <Stat yoy={Y((x) => x.margin.medF2, "pct", "up")} label="Fedezet II / autó (medián)" value={eFt(k.margin.medF2)} tone={(k.margin.medF2 ?? 0) < 0 ? "neg" : undefined} sub={`összesen ${eFt(k.margin.totalF2)}`} />
          <Stat yoy={Y((x) => x.margin.ratio, "bps", "up")} label="Fedezeti hányad" value={pct(k.margin.ratio)} sub={`Fedezet II / nettó árbevétel (${eFt(k.margin.netRevenue)})`} />
          <Stat yoy={Y((x) => x.margin.coverage, "bps", "up")} label="Fix költségek fedezettsége" value={pct(k.margin.coverage)} tone={k.margin.coverage != null && k.margin.coverage < 1 ? "neg" : undefined}
            sub={<>Fedezet II {eFt(k.margin.totalF2)} / fix költség {eFt(k.margin.fixed)} · 100% fölött nyereséges</>} />
          <Stat yoy={Y((x) => x.margin.beRevenueMonthly, "pct", "down")} label="Fedezeti pont (árbevétel)" value={k.margin.beRevenueMonthly == null ? "–" : `${eFt(k.margin.beRevenueMonthly)} / hó`} sub={<>ennyi nettó árbevétel kell a rezsihez · most {eFt(k.margin.monthlyRevenue)} / hó</>} />
          <Stat yoy={Y((x) => x.ops.breakEven, "pct", "down")} label="Fedezeti pont (darab)" value={k.ops.breakEven == null ? "–" : `${num(k.ops.breakEven)} autó / hó`} sub="havi fix költség / átlagos haszon autónként" />
          <Stat yoy={Y((x) => x.margin.safety, "bps", "up")} label="Biztonsági tartalék" value={pct(k.margin.safety)} tone={k.margin.safety != null && k.margin.safety < 0 ? "neg" : undefined} sub="ennyivel eshet az árbevétel a fedezeti pontig" />
          <Stat yoy={Y((x) => x.margin.medDaily, "pct", "up")} label="Napi fedezet / autó (medián)" value={k.margin.medDaily == null ? "–" : `${nf.format(Math.round(k.margin.medDaily))} Ft / nap`}
            sub={<>Fedezet II / állásnap · tőkére vetítve {pct(k.margin.medOnCost)} / autó</>} />
        </div>
      </section>

      <section className="card kpi-sec">
        <h2>Pénz és likviditás</h2>
        <div className="grid cols-4 lp-kpi">
          <Stat yoy={Y((x) => x.money.free, "pct", "up")} label="Szabad pénz" value={eFt(k.money.free)} tone={k.money.free < 0 ? "neg" : undefined}
            sub={<>pénz {eFt(k.money.cash)} − szállítók {eFt(k.money.payables)} − havi fix {eFt(k.money.fixedMonthly)}</>} />
          <Stat yoy={Y((x) => x.money.roc, "bps", "up")} label="Tőkearányos megtérülés" value={pct(k.money.roc)} sub={<>eredmény {eFt(k.money.preTax)} / átlagos készlet {eFt(k.money.avgCapital)}{k.partial ? ", évesítve" : ""}</>} />
          <Stat yoy={Y((x) => x.money.cashCycle, "pct", "down")} label="Készpénzciklus" value={k.money.cashCycle == null ? "–" : `${k.money.cashCycle} nap`} sub="a vétel kifizetésétől az eladási ár beérkezéséig" />
          <Stat yoy={Y((x) => x.money.loans?.balance, "pct", "neutral")} label="Tagi kölcsön" value={eFt(k.money.loans?.balance)}
            sub={k.money.loans ? <>{k.money.loans.nextDue ? `következő lejárat: ${fmtDate(k.money.loans.nextDue)}` : "nincs nyitott lejárat"}{k.money.loans.overdue ? ` · lejárt: ${eFt(k.money.loans.overdue)}` : ""}</> : undefined} />
        </div>
      </section>

      <section className="card kpi-sec">
        <h2>Értékesítés és működés</h2>
        <div className="grid cols-2">
          <div>
            <h3>Havi vett és eladott darabszám</h3>
            <div className="kpi-trend">
              {k.ops.trend.map((m) => (
                <div key={m.ym} className="kpi-tcol" title={`${m.ym}: vett ${m.bought}, eladott ${m.sold}, haszon ${fmtHuf(m.profit)}`}>
                  <div className="kpi-bars">
                    <div className="bar in" style={{ height: `${(m.bought / maxTrend) * 100}%` }} />
                    <div className="bar out" style={{ height: `${(m.sold / maxTrend) * 100}%` }} />
                  </div>
                  <div className="muted kpi-tlab">{MONTHS[Number(m.ym.slice(5)) - 1]}</div>
                  <div className="kpi-tlab">{m.bought}/{m.sold}</div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}><span className="kpi-key in" /> vett · <span className="kpi-key out" /> eladott</div>
          </div>
          <div>
            <div className="grid cols-2 lp-kpi">
              <Stat yoy={Y((x) => x.ops.breakEven, "pct", "down")} label="Fedezeti pont" value={k.ops.breakEven == null ? "–" : `${num(k.ops.breakEven)} autó / hó`} sub={`havi fix költség ${eFt(k.money.fixedMonthly)} / haszon autónként`} />
              <Stat label="Terv vs. tény" value={k.ops.planVsActual.priceDiff == null ? "–" : `${k.ops.planVsActual.priceDiff >= 0 ? "+" : ""}${eFt(k.ops.planVsActual.priceDiff)}`}
                sub={k.ops.planVsActual.count ? <>átlagos eltérés a tervezett ártól ({k.ops.planVsActual.count} autó){k.ops.planVsActual.dateDiff != null ? `, ${k.ops.planVsActual.dateDiff >= 0 ? "+" : ""}${k.ops.planVsActual.dateDiff} nap` : ""}</> : "nincs tervvel eladott autó"} />
            </div>
          </div>
        </div>
      </section>

      <section className="card kpi-sec">
        <h2>Adó és kötelezettségek</h2>
        <div className="grid cols-2">
          <div>
            <h3>Különbözeti ÁFA negyedévente</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Negyedév</th><th className="num">Eladott</th><th className="num">Különbözeti ÁFA</th><th className="num">/ autó</th><th className="num">Tavaly</th><th className="num">Változás</th></tr></thead>
                <tbody>
                  {k.tax.quarters.map((q, i) => {
                    const prev = p?.tax.quarters[i];
                    return (
                      <tr key={q.label}>
                        <td>{q.label}</td><td className="num">{q.count}</td><td className="num">{fmtHuf(q.vat)}</td><td className="num">{q.count ? fmtHuf(q.vat / q.count) : "–"}</td>
                        <td className="num muted">{prev ? fmtHuf(prev.vat) : "–"}</td>
                        <td className="num">{prev && prev.vat ? `${q.vat >= prev.vat ? "+" : "−"}${(Math.round(Math.abs((q.vat - prev.vat) / prev.vat) * 1000) / 10).toLocaleString("hu-HU")}%` : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Átlag az időszakban: {eFt(k.tax.avgMarginVat)} / autó.</p>
          </div>
          <div>
            <h3>EPR-díj – {k.tax.epr?.label ?? "folyó negyedév"}</h3>
            {k.tax.epr ? (
              <div className="grid cols-2 lp-kpi">
                <Stat yoy={Y((x) => x.tax.epr?.fee, "pct", "neutral")} label="Várható EPR-díj" value={eFt(k.tax.epr.fee)} sub={`bevallás: ${fmtDate(k.tax.epr.deadline)}`} />
                <Stat yoy={Y((x) => (x.tax.epr?.sold ? x.tax.epr.liable / x.tax.epr.sold : null), "bps", "neutral")} label="Import aránya" value={k.tax.epr.sold ? pct(k.tax.epr.liable / k.tax.epr.sold) : "–"} sub={`${k.tax.epr.liable} díjköteles a negyedévben eladott ${k.tax.epr.sold} autóból`} />
              </div>
            ) : <p className="muted">Nem számolható.</p>}
            <p className="muted" style={{ fontSize: 13 }}><Link href={`${b}/vehicles/epr`}>EPR összesítő →</Link></p>
          </div>
        </div>
      </section>
      <p className="muted" style={{ fontSize: 12 }}>A mutatók a könyvelt bizonylatokból számolnak; a bekerülési érték a 26x készletszámlára könyvelt összes tétel (vételár + felújítás + egyéb ráfordítás).</p>
    </div>
  );
}
