/** v2.0 – Vendégház eredménykimutatás (P&L) heti / havi / éves bontásban. */
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { loadGuesthouse } from "@/lib/guesthouse";
import { groupBy, kpis, periodLabel, periodRange, sumRange, type Gran, type Kpis } from "@/lib/gh-calc";
import { accommodationStart, availableDays, fmtNum, fmtPct, parseGran, tableScope } from "@/lib/gh-view";
import { fmtHuf } from "@/lib/money";
import { IncludeToggle, ScopeNav, Seg, StatementTable, type StRow } from "@/components/gh/GhUi";

export default async function PnlPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();
  const d = await loadGuesthouse(cid, company.taxProfile);
  const g = parseGran(sp.g, ["week", "month", "year"], "month");
  const sc = tableScope(g, sp.s, d.asOf, d.first);
  const start = accommodationStart(d.days);
  const groups = groupBy(d.days, g, sc.from, sc.to);
  const cols = sc.keys.map((k) => {
    const r = periodRange(k, g);
    return { key: k, label: periodLabel(k, g, g !== "year"), partial: r.from <= d.asOf && r.to > d.asOf, k: kpis(groups.get(k) ?? {}, availableDays(r.from, r.to, start, d.asOf), d.include) };
  });
  const totFrom = sc.from, totTo = sc.to;
  const tot = kpis(sumRange(d.days, totFrom, totTo), availableDays(totFrom, totTo, start, d.asOf), d.include);

  // jövőbeli időszak: üres oszlop (kivéve, ha már van rögzített foglalás)
  const future = (c: (typeof cols)[number]) => periodRange(c.key, g).from > d.asOf && !c.k.revenue;
  const line = (label: string, f: (k: Kpis) => number, o: Partial<StRow> = {}): StRow => ({ label, values: cols.map((c) => (future(c) ? null : f(c.k))), total: f(tot), ...o });
  const neg = (f: (k: Kpis) => number) => (k: Kpis) => -f(k);
  const pct = (x: number | null) => fmtPct(x);
  const rows: StRow[] = [
    { label: "Bevételek", values: [], kind: "head" },
    line("Airbnb (szállásdíj + takarítási díj)", (k) => k.rev.airbnb, { indent: true }),
    line("Booking.com", (k) => k.rev.booking, { indent: true }),
    line("Közvetlen foglalás", (k) => k.rev.direct, { indent: true }),
    line("Egyéb bevétel (pl. hosszú távú bérlet)", (k) => k.rev.other, { indent: true }),
    line("Összes bevétel", (k) => k.revenue, { kind: "sub" }),
    line("Platform jutalék", neg((k) => k.commission), { indent: true }),
    line("Nettó bevétel", (k) => k.netRevenue, { kind: "sub" }),
    { label: "Foglalásonkénti (változó) költségek", values: [], kind: "head" },
    line("Takarítás", neg((k) => k.variableParts.cleaning), { indent: true }),
    line("Anyag, tisztítószer, vendégellátás", neg((k) => k.variableParts.supplies), { indent: true }),
    line("Tűzifa, fűtés", neg((k) => k.variableParts.firewood), { indent: true }),
    line("Fedezet", (k) => k.contribution, { kind: "sub" }),
    { label: "Működési (fix) költségek", values: [], kind: "head" },
    line("Rezsi (villany, víz, internet)", neg((k) => k.fixedParts.utilities), { indent: true }),
    line("Marketing, hirdetés", neg((k) => k.fixedParts.marketing), { indent: true }),
    line("Javítás, eszközbeszerzés", neg((k) => k.fixedParts.repair), { indent: true }),
    line("Egyéb költség", neg((k) => k.fixedParts.other), { indent: true }),
    line("Működési eredmény", (k) => k.operating, { kind: "sub" }),
    { label: "Adók", values: [], kind: "head" },
    line("Tételes átalányadó (időarányosan)", neg((k) => k.flat), { indent: true }),
    line("Turizmusfejlesztési hozzájárulás (4%)", neg((k) => k.tfh), { indent: true }),
    line("Idegenforgalmi adó", neg((k) => k.ifa), { indent: true }),
    line("Eredmény adók után", (k) => k.result, { kind: "total" }),
    line("Árrés", (k) => k.margin ?? NaN, { kind: "kpi", fmt: pct }),
    { label: "Mutatók", values: [], kind: "head" },
    line("Eladott éjszakák", (k) => k.nights, { kind: "kpi", fmt: (x) => fmtNum(x, g === "week" ? 1 : 0) }),
    line("Kihasználtság", (k) => k.occupancy ?? NaN, { kind: "kpi", fmt: pct }),
    line("ADR (Ft / éj)", (k) => k.adr ?? NaN, { kind: "kpi", fmt: (x) => (Number.isFinite(x) ? fmtHuf(x) : "–") }),
    line("RevPAR (Ft / naptári nap)", (k) => k.revpar ?? NaN, { kind: "kpi", fmt: (x) => (Number.isFinite(x) ? fmtHuf(x) : "–") }),
    line("Közvetlen arány", (k) => k.directShare ?? NaN, { kind: "kpi", fmt: pct }),
  ];
  // csupa nulla sorok elrejtése (kivéve összesítők)
  const shown = rows.filter((r) => r.kind === "head" || r.kind === "sub" || r.kind === "total" || r.kind === "kpi" || r.values.some((v) => v && Math.abs(v) >= 0.5) || (r.total && Math.abs(r.total) >= 0.5));

  const base = `/c/${cid}/gh/pnl`;
  const href = (gg: Gran, s?: string | null) => `${base}?g=${gg}${s ? `&s=${s}` : ""}`;
  return (
    <div className="gh">
      <div className="topbar">
        <h1>Eredménykimutatás (P&amp;L)</h1>
        <div className="toolbar">
          <Seg items={(["week", "month", "year"] as Gran[]).map((x) => ({ href: href(x), label: x === "week" ? "Heti" : x === "month" ? "Havi" : "Éves", on: g === x }))} />
          {g !== "year" ? <ScopeNav prev={sc.prev ? href(g, sc.prev) : null} next={sc.next ? href(g, sc.next) : null} label={sc.label} /> : null}
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>Teljesítés szerint: a szállásdíj a vendégéjszakákra, a havi tételek a hónap napjaira, a rezsi a számlázási időszakra osztva.</span>
        <IncludeToggle cid={cid} inc={d.include} back={href(g, sc.scope || null)} />
      </div>
      <StatementTable cols={cols} rows={shown} />
      <p className="muted" style={{ fontSize: 12.5 }}>
        * folyamatban lévő időszak. A tételes adó időarányos, a TFH és az IFA számított érték (a P&amp;L-be a fenti választás szerint kerül). A vételár és az illeték nem költség – a Megtérülés oldalon látszik.
      </p>
    </div>
  );
}
