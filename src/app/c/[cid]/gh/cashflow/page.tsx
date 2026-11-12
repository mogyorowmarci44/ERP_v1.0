/** v2.0 – Vendégház cash flow: tényleges pénzmozgás heti / havi / éves bontásban. */
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { loadGuesthouse } from "@/lib/guesthouse";
import { CF_LINES, cfOf, groupBy, periodLabel, periodRange, sumRange, type Gran } from "@/lib/gh-calc";
import { parseGran, tableScope } from "@/lib/gh-view";
import { IncludeToggle, LineChart, ScopeNav, Seg, StatementTable, type StRow } from "@/components/gh/GhUi";

export default async function CashflowPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();
  const d = await loadGuesthouse(cid, company.taxProfile);
  const g = parseGran(sp.g, ["week", "month", "year"], "month");
  const sc = tableScope(g, sp.s, d.asOf, d.first);
  const to = sc.to > d.asOf ? d.asOf : sc.to;
  const groups = groupBy(d.days, g, sc.from, to);
  const cols = sc.keys.map((k) => {
    const r = periodRange(k, g);
    return { key: k, label: periodLabel(k, g, g !== "year"), partial: r.from <= d.asOf && r.to > d.asOf, c: cfOf(groups.get(k) ?? {}, d.include), end: r.to > d.asOf ? d.asOf : r.to };
  });
  const tot = cfOf(sumRange(d.days, sc.from, to), d.include);
  type C = ReturnType<typeof cfOf>;
  const line = (label: string, f: (c: C) => number, o: Partial<StRow> = {}): StRow => ({ label, values: cols.map((c) => (c.end < periodRange(c.key, g).from ? null : f(c.c))), total: f(tot), ...o });
  const lineOf = (key: string) => (c: C) => c.lines.find((l) => l.key === key)?.amount ?? 0;

  const inLines = CF_LINES.filter(([k]) => k.startsWith("rev_"));
  const outLines = CF_LINES.filter(([k]) => !k.startsWith("rev_"));
  // halmozott pénzállás a kezdettől az időszak végéig
  const cum = (end: string) => cfOf(sumRange(d.days, "0000-01-01", end), d.include).net;
  const rows: StRow[] = [
    { label: "Bevételek", values: [], kind: "head" },
    ...inLines.map(([k, l]) => line(l, lineOf(k), { indent: true })),
    line("Összes bevétel", (c) => c.inflow, { kind: "sub" }),
    { label: "Működési kiadások", values: [], kind: "head" },
    ...outLines.map(([k, l]) => line(l, lineOf(k), { indent: true })),
    line("Tételes adó (esedékesség szerint, számított)", (c) => c.flat, { indent: true }),
    line("TFH (febr. 25., számított)", (c) => c.tfh, { indent: true }),
    line("IFA (számított)", (c) => c.ifa, { indent: true }),
    line("Működési cash flow", (c) => c.operating, { kind: "sub" }),
    { label: "Beruházás", values: [], kind: "head" },
    line("Ingatlan (vételár, illeték)", (c) => c.property, { indent: true }),
    line("Egyéb tárgyi eszköz", (c) => c.invOther, { indent: true }),
    line("Nettó cash flow", (c) => c.net, { kind: "total" }),
    { label: "Halmozott cash flow (kezdettől, az időszak végén)", values: cols.map((c) => (c.end < periodRange(c.key, g).from ? null : cum(c.end))), total: cum(to), kind: "kpi" },
  ];
  const shown = rows.filter((r) => (r.kind ? true : r.values.some((v) => v && Math.abs(v) >= 0.5) || Math.abs(r.total ?? 0) >= 0.5));

  // halmozott cash flow havonta, kezdettől
  const months = groupBy(d.days, "month", d.first, d.asOf);
  let run = 0;
  const pts = [...months.entries()].map(([m, r]) => {
    run += cfOf(r, d.include).net;
    return { label: m.replace("-", ". "), value: run };
  });

  const base = `/c/${cid}/gh/cashflow`;
  const href = (gg: Gran, s?: string | null) => `${base}?g=${gg}${s ? `&s=${s}` : ""}`;
  return (
    <div className="gh">
      <div className="topbar">
        <h1>Cash flow</h1>
        <div className="toolbar">
          <Seg items={(["week", "month", "year"] as Gran[]).map((x) => ({ href: href(x), label: x === "week" ? "Heti" : x === "month" ? "Havi" : "Éves", on: g === x }))} />
          {g !== "year" ? <ScopeNav prev={sc.prev ? href(g, sc.prev) : null} next={sc.next ? href(g, sc.next) : null} label={sc.label} /> : null}
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>A pénz tényleges mozgása: bankszámla + magánpénzből fizetett / magánzsebbe kapott tételek, a fizetés napján.</span>
        <IncludeToggle cid={cid} inc={d.include} back={href(g, sc.scope || null)} />
      </div>
      <StatementTable cols={cols} rows={shown} />
      <h2>Halmozott cash flow a vásárlás óta</h2>
      <div className="card">
        <LineChart title="Halmozott cash flow havonta" series={[{ name: "Halmozott cash flow", color: "var(--accent)", points: pts }]} />
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        * folyamatban lévő időszak (a mai napig). A tételes adó, a TFH és az IFA számított, esedékesség szerinti kiáramlás – a könyvelt befizetések a „Könyvelt adóbefizetés” sorban vannak. Az Airbnb a jutalékot a kifizetésből vonja le, ezért az Airbnb-bevétel itt nettó.
      </p>
    </div>
  );
}
