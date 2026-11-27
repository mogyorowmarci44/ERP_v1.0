import Link from "next/link";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { fyRange, openedYears, yearChecklist } from "@/lib/year-open";
import { openYearAction } from "./actions";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * v6.6.0 – Évnyitás: a lezárt üzleti évek eredményének átvezetése az eredménytartalékba, előtte ellenőrzőlistával.
 * A mérlegszámlák egyenlege magától nyit; ez a lépés az eredményt teszi tényleges tétellé, és lezárja az évet.
 */
export default async function YearOpenPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const sm = company.fiscalYearStartMonth;
  const t = today();
  const [first] = await db.select({ d: sql<string>`min(${schema.journalEntries.date})` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
  const done = await openedYears(cid, sm);
  const years: number[] = [];
  if (first?.d) {
    const [y0, m0] = first.d.split("-").map(Number);
    for (let fy = m0 >= sm ? y0 : y0 - 1; fyRange(fy, sm).next <= t; fy++) years.push(fy);
  }
  const rows = await Promise.all(years.reverse().map(async (fy) => ({ fy, ...(await yearChecklist(cid, fy, sm)), done: done.get(fy) })));
  const nextTodo = [...rows].reverse().find((r) => !r.done && Math.abs(r.result) >= 0.5)?.fy;
  const w = role === "owner" || role === "accountant";
  return (
    <>
      <p><Link href={`/c/${cid}/closing`}>← Évzárás</Link></p>
      <h1>Évnyitás</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted" style={{ marginTop: -4 }}>
        A mérlegszámlák (eszközök, források) egyenlege a következő évben magától nyit, az eredményszámlák üzleti évenként nulláról indulnak.
        Az évnyitás a lezárt év <strong>adózott eredményét átvezeti az eredménytartalékba</strong> (nyereségnél T 493 / K 414, veszteségnél fordítva)
        a következő üzleti év első napjára, és kérésre zárolja az év hónapjait. Előtte érdemes az ellenőrzőlista minden pontját rendezni.
        Osztalékot a döntés után külön, vegyes tételként könyvelj (pl. T 414 / K 479).
      </p>
      {rows.length === 0 && <p className="muted">Még nincs lezárt üzleti év.</p>}
      <div className="grid" style={{ gap: 12 }}>
        {rows.map((r) => (
          <div key={r.fy} className="card" style={{ borderLeft: `4px solid ${r.done || Math.abs(r.result) < 0.5 ? "var(--pos)" : "var(--line)"}` }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{r.fy}{sm !== 1 ? `/${String(r.fy + 1).slice(2)}` : ""} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{fmtDate(r.from)} – {fmtDate(r.to)}</span></h3>
              {r.done
                ? <span className="badge posted">átvezetve · {r.done.number}</span>
                : Math.abs(r.result) < 0.5 ? <span className="badge posted">nincs átvezetendő eredmény</span> : <span className="badge draft">átvezetésre vár</span>}
            </div>
            <div className="grid cols-2" style={{ marginTop: 10 }}>
              <div className="card stat"><div className="label">Adózott eredmény</div><div className={r.result < 0 ? "value neg" : "value"}>{fmtHuf(r.result)}</div></div>
              <div className="card stat"><div className="label">Ebből társasági adó (891)</div><div className="value">{fmtHuf(r.tax)}</div></div>
            </div>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
              {r.items.map((i) => (
                <li key={i.key}>{i.ok ? "✓" : "⚠"} <Link href={`/c/${cid}/${i.href}`}>{i.label}</Link></li>
              ))}
            </ul>
            {!r.done && Math.abs(r.result) >= 0.5 && w && (
              <form action={openYearAction} className="row" style={{ gap: 10, marginTop: 10 }}>
                <input type="hidden" name="cid" value={cid} />
                <input type="hidden" name="fy" value={r.fy} />
                <label className="check"><input type="checkbox" name="lock" defaultChecked /> az év hónapjait is zárolom</label>
                <ConfirmButton className="primary" disabled={nextTodo !== r.fy}
                  message={`Évnyitás: a ${r.fy}. év ${r.result > 0 ? "nyereségét" : "veszteségét"} (${fmtHuf(Math.abs(r.result))} Ft) átvezetem az eredménytartalékba ${fmtDate(fyRange(r.fy, sm).next)} dátummal.${r.items.some((i) => !i.ok) ? " Figyelem: az ellenőrzőlista nem teljes!" : ""}`}>
                  Évnyitás {r.fy + 1}
                </ConfirmButton>
                {nextTodo !== r.fy && <span className="muted small">Előbb a korábbi évet nyisd.</span>}
              </form>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
