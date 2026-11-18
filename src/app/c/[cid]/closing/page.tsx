import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { trialBalance, type TrialBalanceRow } from "@/lib/reports";
import { listAnnualYears } from "@/lib/annual-report";
import { firstEntryDate } from "@/lib/forecast-data";
import { fmtHuf } from "@/lib/money";
import { today, monthEnd } from "@/lib/dates";
import { depreciationStatus } from "@/lib/assets";
import { Scale, BookOpenCheck, Lock, LockOpen, Package } from "lucide-react";

export const dynamic = "force-dynamic";

const sumBy = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
const flowBy = (tb: TrialBalanceRow[], pred: (c: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0);

/** Évzárás: a főkönyvi kivonat és az éves beszámoló évenként – külön a lezárt (előző) évek és a folyó év. */
export default async function ClosingPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const t = today();
  const cur = Number(t.slice(0, 4));
  const first = await firstEntryDate(cid);
  const firstYear = first ? Number(first.slice(0, 4)) : cur;
  const [stored, locks] = await Promise.all([
    listAnnualYears(cid),
    db.select({ year: schema.periodLocks.year, month: schema.periodLocks.month }).from(schema.periodLocks).where(and(eq(schema.periodLocks.companyId, cid))),
  ]);
  const years = Array.from({ length: cur - firstYear + 1 }, (_, i) => cur - i);
  const data = await Promise.all(years.map(async (y) => {
    const from = `${y}-01-01`, to = y === cur ? monthEnd(t) : `${y}-12-31`;
    const [period, closing] = await Promise.all([trialBalance(cid, from, to), trialBalance(cid, first ?? from, to)]);
    const preTax = -flowBy(period, (c) => c.startsWith("9")) - flowBy(period, (c) => c.startsWith("5") || c.startsWith("8"));
    const total = sumBy(closing, (c) => /^[123]/.test(c));
    const locked = locks.filter((l) => l.year === y).length;
    const dep = await depreciationStatus(cid, y);
    return { y, from, to, preTax, total, locked, report: stored.includes(y), dep };
  }));
  const closed = data.filter((d) => d.y < cur);
  const current = data.find((d) => d.y === cur)!;

  const YearCard = ({ d, current: isCur }: { d: (typeof data)[number]; current?: boolean }) => (
    <div className="card cl-year">
      <div className="fc-head">
        <h3 style={{ margin: 0 }}>{d.y}{isCur ? " – folyó év" : ""}</h3>
        <div className="row" style={{ gap: 6 }}>
          {d.locked === 12
            ? <span className="badge posted"><Lock size={12} /> mind a 12 hónap lezárva</span>
            : <span className={`badge ${isCur ? "draft" : "overdue"}`}><LockOpen size={12} /> {d.locked}/12 hónap lezárva</span>}
          {d.dep.hasAssets && (d.dep.openMonths.length
            ? <Link href={`/c/${cid}/assets?to=${d.dep.upTo}`} className="badge overdue"><Package size={12} /> ÉCS elszámolatlan: {d.dep.openMonths.length} hónap</Link>
            : <span className="badge posted"><Package size={12} /> ÉCS elszámolva ({d.dep.upTo}-ig)</span>)}
          {d.report ? <span className="badge posted">beszámoló mentve</span> : !isCur && <span className="badge draft">beszámoló nincs mentve</span>}
        </div>
      </div>
      <div className="grid cols-2 lp-kpi" style={{ marginTop: 10 }}>
        <div className="card stat"><div className="label">Adózás előtti eredmény{isCur ? " (eddig)" : ""}</div><div className={d.preTax < 0 ? "value neg" : "value"}>{fmtHuf(d.preTax)}</div></div>
        <div className="card stat"><div className="label">Mérlegfőösszeg ({isCur ? "mai" : "dec. 31."})</div><div className="value">{fmtHuf(d.total)}</div></div>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <Link className="btn" href={`/c/${cid}/reports/trial-balance?from=${d.from}&to=${d.to}`}><Scale size={16} /> Főkönyvi kivonat {d.y}</Link>
        {d.dep.hasAssets && <Link className="btn" href={`/c/${cid}/assets?year=${d.y}`}><Package size={16} /> Eszköztükör {d.y}</Link>}
        <Link className={`btn${isCur ? "" : " primary"}`} href={`/c/${cid}/reports/annual?year=${d.y}`}><BookOpenCheck size={16} /> Éves beszámoló {d.y}{isCur ? " (előzetes)" : ""}</Link>
      </div>
    </div>
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Évzárás</h1>
          <span className="muted">{company.name} · főkönyvi kivonat és éves beszámoló évenként</span>
        </div>
        <Link className="btn" href={`/c/${cid}/settings`}>Időszakok lezárása (Beállítások)</Link>
      </div>

      <h2>Folyó év</h2>
      <YearCard d={current} current />

      <h2 style={{ marginTop: 20 }}>Lezárt évek</h2>
      {closed.length ? closed.map((d) => <YearCard key={d.y} d={d} />) : <p className="muted">Még nincs lezárt üzleti év.</p>}
    </>
  );
}
