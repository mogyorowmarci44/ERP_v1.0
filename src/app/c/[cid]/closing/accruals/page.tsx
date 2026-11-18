import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { accrualBalances, openAccruals } from "@/lib/accruals";
import { releaseAccrualAction } from "../../actions";

export const dynamic = "force-dynamic";

/** Időbeli elhatárolások: nyitott tételek és feloldásuk. */
export default async function AccrualsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [items, bal] = await Promise.all([openAccruals(cid), accrualBalances(cid)]);
  const curMonth = today().slice(0, 7);
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Időbeli elhatárolások</h1>
          <span className="muted">{company.name} · 39x aktív, 48x passzív elhatárolások</span>
        </div>
        <Link className="btn" href={`/c/${cid}/closing`}>← Évzárás</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid cols-4 lp-kpi" style={{ marginBottom: 14 }}>
        {bal.length === 0 ? <div className="card stat"><div className="label">Egyenleg</div><div className="value">0</div></div>
          : bal.map((b) => <div key={b.code} className="card stat"><div className="label">{b.code} {b.name}</div><div className="value">{fmtHuf(Math.abs(b.balance))}</div></div>)}
      </div>
      <p className="muted">
        A becsült költség / bevétel elhatárolását a következő időszakban fel kell oldani: vagy a „Feloldás” gombbal (ellentétes tétel a választott napon),
        vagy úgy, hogy a megérkező számlát közvetlenül az elhatárolási számlára könyveled. A lista azokat a tételeket mutatja, amelyekhez még nincs feloldás.
      </p>
      {items.length === 0 ? <p className="muted">Nincs nyitott elhatárolás.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tétel</th><th>Dátum</th><th>Szöveg</th><th>Számla</th><th className="num">Összeg</th><th>Kor</th><th /></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.entryId}>
                  <td className="mono"><Link href={`/c/${cid}/journal/${a.entryId}/edit`}>{a.number}</Link></td>
                  <td>{fmtDate(a.date)}</td><td>{a.description}</td>
                  <td>{a.account} <span className="muted small">({a.kind})</span></td>
                  <td className="num">{fmtHuf(a.amount)}</td>
                  <td>{a.date.slice(0, 7) < curMonth ? <span className="badge overdue">{a.ageDays} napja</span> : <span className="badge draft">folyó hónap</span>}</td>
                  <td>
                    {canWrite && (
                      <form action={releaseAccrualAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="cid" value={cid} /><input type="hidden" name="entryId" value={a.entryId} />
                        <input type="date" name="date" defaultValue={today()} aria-label="Feloldás dátuma" />
                        <ConfirmButton className="small" message={`Feloldod a(z) ${a.number} elhatárolást (ellentétes tétel)?`} pendingText="…">Feloldás</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
