/** v2.0 – Vendégház áttekintés: mutatók heti / havi / éves bontásban, összevetéssel. */
import Link from "next/link";
import type { TaxProfile } from "@/db/schema";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PNL_INCLUDE_LABEL, flatRateSchedule, vatExemptThreshold } from "@/lib/entity";
import { loadGuesthouse, propertyReturn } from "@/lib/guesthouse";
import { SALE_METHOD_LABEL } from "@/lib/valuation";
import { addDays, breakEven, groupBy, kpis, paybackFlows, paybackSummary, periodKey, periodLabel, periodRange, prevPeriod, sumRange, type Gran } from "@/lib/gh-calc";
import { accommodationStart, availableDays, comparison, fmtNum, fmtPct, parseGran } from "@/lib/gh-view";
import { Flash } from "@/components/Flash";
import { RefreshCard } from "./RefreshCard";
import { IncludeToggle, Kpi, Meter, Seg, ScopeNav } from "@/components/gh/GhUi";

const HU_M = ["jan", "feb", "már", "ápr", "máj", "jún", "júl", "aug", "szep", "okt", "nov", "dec"];

export async function GhOverview({ cid, profile, sp }: { cid: number; profile: TaxProfile | null; sp: Record<string, string> }) {
  const d = await loadGuesthouse(cid, profile);
  const g = parseGran(sp.g, ["week", "month", "year"], "month");
  const asOf = d.asOf;
  const start = accommodationStart(d.days);
  const curKey = periodKey(asOf, g);
  const key = sp.p && periodRange(sp.p, g).from <= asOf && sp.p.length === curKey.length ? sp.p : curKey;
  const c = comparison(key, g, asOf);
  const k = (r: { from: string; to: string }) => kpis(sumRange(d.days, r.from, r.to), availableDays(r.from, r.to, start, asOf), d.include);
  const cur = k(c.cur), prev = k(c.prev), ly = k(c.ly);

  const base = `/c/${cid}`;
  const href = (gg: Gran, p?: string) => `${base}?g=${gg}${p ? `&p=${p}` : ""}`;
  const prevKey = prevPeriod(key, g);
  const nextFrom = addDays(periodRange(key, g).to, 1);
  const nextKey = nextFrom <= asOf ? periodKey(nextFrom, g) : null;

  // utolsó 12 hónap: fedezeti pont
  const ttmFrom = addDays(asOf, -364);
  const ttm = kpis(sumRange(d.days, ttmFrom, asOf), availableDays(ttmFrom, asOf, start, asOf), d.include);
  const be = breakEven(ttm, 12);

  // megtérülés
  const pb = d.t0 && d.base > 0 ? paybackSummary(paybackFlows(d.days, d.include, d.t0, d.df, asOf), d.base, d.df, asOf) : null;

  const pr = propertyReturn(d);

  // ÁFA-keret és tételes adó (tárgyév)
  const year = Number(asOf.slice(0, 4));
  const yr = kpis(sumRange(d.days, `${year}-01-01`, `${year}-12-31`), 0, d.include);
  const threshold = vatExemptThreshold(year);
  const sched = flatRateSchedule(d.profile.rooms, d.profile.flatRatePerRoom, year);
  const nextInst = sched.installments.find((i) => i.due >= asOf) ?? flatRateSchedule(d.profile.rooms, d.profile.flatRatePerRoom, year + 1).installments[0];

  // hőtérkép: év × hónap
  const months = groupBy(d.days, "month", start ? `${start.slice(0, 4)}-01-01` : `${year}-01-01`, `${year}-12-31`);
  const years = [...new Set([...months.keys()].map((m) => m.slice(0, 4)))];
  const cell = (m: string) => {
    const r = months.get(m) ?? {};
    const pr = periodRange(m, "month");
    return kpis(r, availableDays(pr.from, pr.to, start, asOf), d.include);
  };
  const maxRev = Math.max(1, ...[...months.keys()].map((m) => cell(m).accRevenue));

  const per = g === "week" ? "hét" : g === "month" ? "hónap" : "év";
  return (
    <div className="gh">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="topbar">
        <div>
          <h1>Áttekintés</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {fmtDate(c.cur.from)} – {fmtDate(c.partial ? asOf : c.fullTo)}
            {c.partial ? ` · folyamatban lévő ${per}, az összevetés az azonos hosszúságú időszakkal` : ""}
          </div>
        </div>
        <div className="toolbar">
          <Seg items={(["week", "month", "year"] as Gran[]).map((x) => ({ href: href(x), label: x === "week" ? "Hét" : x === "month" ? "Hónap" : "Év", on: g === x }))} />
          <ScopeNav prev={start && periodRange(prevKey, g).to >= start ? href(g, prevKey) : null} next={nextKey ? href(g, nextKey) : null} label={periodLabel(key, g)} />
        </div>
      </div>

      <div className="grid cols-4">
        <Kpi label="Bevétel" value={fmtHuf(cur.revenue)} unit="Ft" cur={cur.revenue} prev={prev.revenue} ly={ly.revenue} />
        <Kpi label={`Eredmény adók után (TFH/IFA: ${PNL_INCLUDE_LABEL[d.include].toLowerCase()})`} value={fmtHuf(cur.result)} unit="Ft" cur={cur.result} prev={prev.result} ly={ly.result} />
        <Kpi label="Árrés" value={fmtPct(cur.margin)} cur={cur.margin} prev={prev.margin} ly={ly.margin} kind="pp" hint="eredmény a bevétel %-ában" />
        <Kpi label="Nettó cash flow" value={fmtHuf(cur.cfNet)} unit="Ft" cur={cur.cfNet} prev={prev.cfNet} ly={ly.cfNet} hint="tényleges pénzmozgás az időszakban" />
        <Kpi label="Kihasználtság" value={fmtPct(cur.occupancy)} cur={cur.occupancy} prev={prev.occupancy} ly={ly.occupancy} kind="pp" hint={`${fmtNum(cur.nights, cur.nightsEstimated ? 1 : 0)} eladott éj${cur.nightsEstimated ? " (részben becsült)" : ""}`} />
        <Kpi label="ADR – átlagos éjszakadíj" value={fmtHuf(cur.adr)} unit="Ft" cur={cur.adr} prev={prev.adr} ly={ly.adr} />
        <Kpi label="RevPAR – bevétel / naptári nap" value={fmtHuf(cur.revpar)} unit="Ft" cur={cur.revpar} prev={prev.revpar} ly={ly.revpar} />
        <Kpi label="Átlagos tartózkodás (Airbnb)" value={cur.los ? fmtNum(cur.los, 1) : "–"} unit="éj" cur={cur.los} prev={prev.los} ly={ly.los} />
        <Kpi label="Közvetlen foglalás aránya" value={fmtPct(cur.directShare)} cur={cur.directShare} prev={prev.directShare} ly={ly.directShare} kind="pp" hint="jutalékmentes bevétel a szállásbevételből" />
        <Kpi label="Airbnb jutalék" value={fmtPct(cur.commissionPct, 1)} cur={cur.commissionPct} prev={prev.commissionPct} ly={ly.commissionPct} kind="pp" invert hint={`${fmtHuf(cur.commission)} Ft az Airbnb-bevételből`} />
        <Kpi label="Marketing ROAS" value={cur.roas !== null ? `${fmtNum(cur.roas, 1)}×` : "–"} cur={cur.roas} prev={prev.roas} ly={ly.roas} hint={`közvetlen bevétel / ${fmtHuf(cur.marketing)} Ft hirdetés`} />
        <Kpi label="Foglalásonkénti költség / éj" value={fmtHuf(cur.varPerNight)} unit="Ft" cur={cur.varPerNight} prev={prev.varPerNight} ly={ly.varPerNight} invert hint="takarítás + anyag + tűzifa" />
      </div>

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <div className="card kpi">
          <div className="label">Fedezeti pont (utolsó 12 hónap alapján)</div>
          <div className="value">{be.nightsPerMonth !== null ? fmtNum(be.nightsPerMonth, 1) : "–"}<small>éj / hó</small></div>
          <div className="hint">
            Fix költség + tételes adó: {fmtHuf(be.fixedPerMonth)} Ft/hó · egy éjszaka fedezete: {fmtHuf(be.contributionPerNight)} Ft · tényleges: {fmtNum(ttm.nights / 12, 1)} éj/hó
          </div>
        </div>
        <Link href={`${base}/gh/payback`} className="card kpi" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="label">Megtérülés (inflációval diszkontálva)</div>
          <div className="value">{pb ? fmtPct(pb.recoveredPct) : "–"}<small>{pb ? `· ${fmtHuf(pb.cumDiscounted)} / ${fmtHuf(pb.base)} Ft` : ""}</small></div>
          {pb ? <Meter pct={pb.recoveredPct} label="Megtérült hányad" /> : null}
          <div className="hint">{pb ? (pb.reachedDiscounted ? `Megtérült: ${fmtDate(pb.reachedDiscounted)}` : pb.projectedDiscounted ? `Várható megtérülés: ${pb.projectedDiscounted.slice(0, 7).replace("-", ". ")}.` : "A mostani tempóval nem térül meg") : "Nincs ingatlan bekerülési érték (12x számla)."}</div>
        </Link>
        {pr ? (
          <Link href={`${base}/gh/payback#piaci-ertek`} className="card kpi" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="label">Ha ma eladnám ({SALE_METHOD_LABEL[pr.method].toLowerCase()} érték)</div>
            <div className="value">{fmtNum(pr.price / 1e6, 1)}<small>M Ft · nettó {fmtNum(pr.sale.net / 1e6, 1)} M</small></div>
            <div className="hint">teljes nyereség: {pr.totalNominal >= 0 ? "+" : ""}{fmtNum(pr.totalNominal / 1e6, 1)} M Ft · IRR {fmtPct(pr.irrNominal, 1)} (reál {fmtPct(pr.irrReal, 1)})</div>
          </Link>
        ) : null}
        <div className="card kpi">
          <div className="label">Alanyi ÁFA-mentességi keret ({year})</div>
          <div className="value">{fmtPct(yr.revenue / threshold)}<small>· {fmtHuf(yr.revenue)} / {fmtHuf(threshold)} Ft</small></div>
          <Meter pct={yr.revenue / threshold} label="ÁFA-keret kihasználtsága" />
          <div className="hint">{d.profile.szjaMethod === "flat_rate_room" && nextInst ? `Következő tételes adó részlet: ${fmtHuf(nextInst.amount)} Ft · ${fmtDate(nextInst.due)}` : ""}</div>
        </div>
      </div>

      <RefreshCard cid={cid} profile={d.profile} />

      <div className="row" style={{ justifyContent: "space-between", marginTop: 26 }}>
        <h2 style={{ margin: 0 }}>Szezonalitás – szállásbevétel és kihasználtság havonta</h2>
        <IncludeToggle cid={cid} inc={d.include} back={href(g, key === curKey ? undefined : key)} />
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="heat">
          <thead>
            <tr><th>Év</th>{HU_M.map((m) => <th key={m}>{m}</th>)}<th>Összesen</th></tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const tot = kpis(sumRange(d.days, `${y}-01-01`, `${y}-12-31`), availableDays(`${y}-01-01`, `${y}-12-31`, start, asOf), d.include);
              return (
                <tr key={y}>
                  <td><strong>{y}</strong></td>
                  {HU_M.map((_, i) => {
                    const m = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const x = cell(m);
                    const a = x.accRevenue / maxRev;
                    const future = `${m}-01` > asOf;
                    return (
                      <td key={m} className="cell" title={`${m}: ${fmtHuf(x.accRevenue)} Ft · kihasználtság ${fmtPct(x.occupancy)} · ADR ${fmtHuf(x.adr)} Ft`} style={{ background: future || !x.accRevenue ? undefined : `color-mix(in srgb, var(--accent) ${Math.round(8 + a * 62)}%, var(--surface))`, color: a > 0.55 ? "var(--accent-ink)" : undefined }}>
                        {future || !x.accRevenue ? "" : <>{Math.round(x.accRevenue / 1000)}e<br /><span style={{ opacity: 0.8 }}>{fmtPct(x.occupancy)}</span></>}
                      </td>
                    );
                  })}
                  <td className="cell"><strong>{fmtHuf(tot.accRevenue)}</strong><br /><span className="muted">{fmtPct(tot.occupancy)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Cellánként: szállásbevétel (ezer Ft) és kihasználtság. Az Airbnb-foglalások éjszakái pontosak; a Booking (2022–23) és a régi közvetlen foglalások havi összesítőiből az éjszakák becsültek (24 000 Ft/éj).
      </p>
    </div>
  );
}
