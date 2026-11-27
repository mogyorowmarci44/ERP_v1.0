import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { officeOverview, type Pulse } from "@/lib/office";
import { closeLagMonths, daysTo } from "@/lib/office-calc";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { fmtDate, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * v6.9.0 – Könyvelőirodai nézet: az összes cég határideje, teendője, ÁFA-állapota és zárása egy oldalon,
 * a legsürgősebb elöl. Szűrhető a teendős cégekre.
 */
export default async function OfficePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const t = today();
  const all = await officeOverview(user.id);
  const urgency = (p: Pulse) => Math.min(...[p.vatDue, p.payrollDue].filter((x): x is string => !!x).map((d) => daysTo(d, t)), 999) - p.todo * 3;
  const onlyTodo = sp.f === "todo";
  const list = all.filter((p) => !onlyTodo || p.todo > 0 || p.overdueRecv > 0).sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name, "hu"));
  // összesített határidő-naptár (30 nap)
  const cal = all.flatMap((p) => [
    ...(p.vatDue ? [{ date: p.vatDue, what: "ÁFA-bevallás", p }] : []),
    ...(p.payrollDue ? [{ date: p.payrollDue, what: "Járulékbevallás", p }] : []),
  ]).filter((x) => daysTo(x.date, t) <= 30).sort((a, b) => a.date.localeCompare(b.date) || a.p.name.localeCompare(b.p.name, "hu"));
  const dueBadge = (d: string | null) => {
    if (!d) return <span className="muted">–</span>;
    const n = daysTo(d, t);
    return <span className={`badge ${n < 0 ? "overdue" : n <= 5 ? "soon" : "draft"}`}>{fmtDate(d)} · {n < 0 ? `${-n} napja lejárt` : n === 0 ? "ma" : `${n} nap`}</span>;
  };
  return (
    <div className="main" style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Iroda – összes cég</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/">← Cégeim</Link></div>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        {all.length} cég · {all.reduce((s, p) => s + p.todo, 0)} teendő · a legsürgősebb elöl. A számok a cég oldalára visznek.
      </p>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <Link href="?" className={!onlyTodo ? "on" : undefined}>Mind ({all.length})</Link>
        <Link href="?f=todo" className={onlyTodo ? "on" : undefined}>Csak teendős ({all.filter((p) => p.todo > 0 || p.overdueRecv > 0).length})</Link>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Cég</th><th>ÁFA-bevallás</th><th className="num">Záratlan ÁFA-időszak</th><th>Járulékbevallás</th><th className="num">Beérkező</th><th className="num">Piszkozat</th><th className="num">Lejárt vevő</th><th>Utolsó könyvelés</th><th>Zárolva</th></tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const lag = closeLagMonths(p.lockedThrough, t);
              const b = `/c/${p.id}`;
              return (
                <tr key={p.id}>
                  <td><Link href={b}><strong>{p.name}</strong></Link>{p.role !== "owner" && <span className="muted" style={{ fontSize: 11 }}> · {p.role === "accountant" ? "könyvelő" : "olvasó"}</span>}</td>
                  <td>{dueBadge(p.vatDue)}</td>
                  <td className="num">{p.vatOpen ? <Link href={`${b}/reports/vat/closing`} className="badge overdue">{p.vatOpen}</Link> : <span className="muted">0</span>}</td>
                  <td>{dueBadge(p.payrollDue)}</td>
                  <td className="num">{p.inbox ? <Link href={`${b}/inbox`}>{p.inbox}</Link> : <span className="muted">0</span>}</td>
                  <td className="num">{p.drafts ? <Link href={`${b}/invoices`}>{p.drafts}</Link> : <span className="muted">0</span>}</td>
                  <td className="num">{p.overdueRecv ? <Link href={`${b}/reports/open-items?dir=out`}>{p.overdueRecv}</Link> : <span className="muted">0</span>}</td>
                  <td>{p.lastEntry ? fmtDate(p.lastEntry) : <span className="muted">még nincs</span>}</td>
                  <td>{p.lockedThrough ? <span className={`badge ${lag && lag > 1 ? "soon" : "posted"}`}>{p.lockedThrough}-ig{lag ? ` (${lag} hó lemaradás)` : ""}</span> : <span className="muted">–</span>}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={9} className="muted">{onlyTodo ? "Nincs teendős cég. 🎉" : "Még nincs céged."}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Határidők a következő 30 napban</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Határidő</th><th>Bevallás</th><th>Cég</th></tr></thead>
          <tbody>
            {cal.map((x, i) => (
              <tr key={i}><td>{dueBadge(x.date)}</td><td>{x.what}</td><td><Link href={`/c/${x.p.id}/filings`}>{x.p.name}</Link></td></tr>
            ))}
            {cal.length === 0 && <tr><td colSpan={3} className="muted">Nincs határidő a következő 30 napban.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Az ÁFA-határidő a cég bevallási gyakorisága szerint (havi / negyedéves: 20-a, éves: febr. 25.), a járulékbevallásé a tárgyhót követő hónap 12-e – ez utóbbi
        csak azoknál a cégeknél látszik, ahol be van kapcsolva a bérszámfejtés és van dolgozó.
      </p>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
