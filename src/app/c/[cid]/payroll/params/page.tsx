import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { operatorParams } from "@/lib/legal-params";
import { history, resolveAt } from "@/lib/legal-params-calc";
import { PARAM_LABELS } from "@/lib/payroll-calc";
import { fmtDate, today } from "@/lib/dates";
import { fmtNum } from "@/lib/money";
import { saveMemberTbAccountAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Bérparaméterek egy napra – v6.4.0: a jogszabályi értékeket az üzemeltető tartja karban, dátumtól hatályosan
 * (minden ügyfélre érvényes); itt csak megtekinthetők. A cég a társas vállalkozói járulék költségszámláját állítja.
 */
export default async function PayrollParamsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role, company, user } = await requireCompany(cid);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date : today();
  const op = await operatorParams();
  const rows = PARAM_LABELS.filter((p) => p.key !== "memberTbAccount").map((p) => {
    const h = history(`payroll.${p.key}`, op);
    const cur = resolveAt(h, date);
    const next = h.find((x) => x.from > date);
    return { ...p, cur, next };
  });
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Bérparaméterek – {fmtDate(date)}</h1>
          <span className="muted">Jogszabályi értékek, dátumtól hatályosan · az üzemeltető tartja karban, minden cégre érvényesek</span>
        </div>
        <Link className="btn" href={`/c/${cid}/payroll?period=${today().slice(0, 7)}`}>← Bértábla</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card" style={{ marginBottom: 12 }}>
        <label>Nap<input type="date" name="date" defaultValue={date} /></label>
        <button style={{ alignSelf: "end" }}>Megnyitás</button>
      </form>
      <div className="card">
        <table className="cv-calc">
          <thead><tr><th>Paraméter</th><th className="num">Érték</th><th>Hatályos</th><th>Következő változás</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{r.cur ? fmtNum(r.cur.value, { maximumFractionDigits: 4 }) : "–"} <span className="muted small">{r.unit}</span></td>
                <td className="muted small">{r.cur ? `${fmtDate(r.cur.from)}-tól${r.cur.source === "operator" ? " · frissítve" : ""}` : ""}</td>
                <td className="muted small">{r.next ? `${fmtDate(r.next.from)}: ${fmtNum(r.next.value, { maximumFractionDigits: 4 })} ${r.unit}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          A havi bérszámfejtés a hónap utolsó napján hatályos értékekkel számol.
          {user.isPlatformAdmin && <> Módosítás: <Link href="/admin/params">Admin › Jogszabályi paraméterek</Link>.</>}
        </p>
      </div>

      <h2>A cég beállítása</h2>
      <form action={saveMemberTbAccountAction} className="card row" style={{ gap: 10 }}>
        <input type="hidden" name="cid" value={cid} />
        <label>Társas vállalkozó helyett viselt járulék – költségszámla
          <input name="account" defaultValue={company.settings.payrollMemberTbAccount ?? "551"} style={{ width: 100 }} disabled={role !== "owner"} />
        </label>
        <button className="primary" style={{ alignSelf: "end" }} disabled={role !== "owner"}>Mentés</button>
      </form>
    </>
  );
}
