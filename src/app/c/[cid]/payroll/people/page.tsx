import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { listPeople } from "@/lib/payroll";
import { KIND_LABEL, KIND_SHORT, isEfo, type EmploymentKind } from "@/lib/payroll-calc";
import { saveEmployeeAction, deleteEmployeeAction, saveEmploymentAction, deleteEmploymentAction } from "../actions";
import { UserPlus } from "lucide-react";

export const dynamic = "force-dynamic";

function EmploymentForm({ cid, employeeId, e, canWrite }: { cid: number; employeeId: number; e?: Awaited<ReturnType<typeof listPeople>>[number]["employments"][number]; canWrite: boolean }) {
  return (
    <form action={saveEmploymentAction} className="form-grid" style={{ marginTop: 8 }}>
      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="employeeId" value={employeeId} />
      {e && <input type="hidden" name="id" value={e.id} />}
      <label>Jogviszony
        <select name="kind" defaultValue={e?.kind ?? "full"} disabled={!canWrite}>
          {(Object.keys(KIND_LABEL) as EmploymentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label>Kezdete<input type="date" name="startDate" defaultValue={e?.startDate ?? today()} required disabled={!canWrite} /></label>
      <label>Megszűnése<input type="date" name="endDate" defaultValue={e?.endDate ?? ""} disabled={!canWrite} /></label>
      <label>Havi alapbér / tagi jövedelem (Ft)<input name="monthlyWage" inputMode="decimal" defaultValue={e ? String(Number(e.monthlyWage)) : ""} placeholder="EFO-nál üres" disabled={!canWrite} /></label>
      <label>Napidíj (Ft, csak EFO)<input name="dailyWage" inputMode="decimal" defaultValue={e && Number(e.dailyWage) ? String(Number(e.dailyWage)) : ""} disabled={!canWrite} /></label>
      <label>Heti óra (csak „egyéb” részmunkaidő)<input name="weeklyHours" inputMode="numeric" defaultValue={e?.weeklyHours ?? ""} disabled={!canWrite} /></label>
      <label className="row" style={{ alignItems: "center", gap: 6 }}><input type="checkbox" name="guaranteedMin" defaultChecked={e?.guaranteedMin ?? false} disabled={!canWrite} /> Garantált bérminimum (középfokú végzettséget igényel)</label>
      <label>Megjegyzés<input name="note" defaultValue={e?.note ?? ""} disabled={!canWrite} /></label>
      {canWrite && <div className="row" style={{ alignSelf: "end" }}><button className={e ? "" : "primary"}>{e ? "Jogviszony mentése" : "Jogviszony hozzáadása"}</button></div>}
    </form>
  );
}

/** Dolgozók és jogviszonyaik (teljes, rész, alkalmi, idény, társas vállalkozó). */
export default async function PeoplePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const canWrite = role !== "viewer";
  const people = await listPeople(cid);
  const t = today();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dolgozók és jogviszonyok</h1>
          <span className="muted">{company.name} · {people.length} személy</span>
        </div>
        <Link className="btn" href={`/c/${cid}/payroll`}>← Bértábla</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      {canWrite && (
        <form action={saveEmployeeAction} className="card form-grid" style={{ marginBottom: 16 }}>
          <input type="hidden" name="cid" value={cid} />
          <label>Név<input name="name" required /></label>
          <label>Adóazonosító jel<input name="taxId" inputMode="numeric" placeholder="10 számjegy" /></label>
          <label>Munkakör<input name="position" /></label>
          <label>Megjegyzés<input name="note" /></label>
          <div className="row" style={{ alignSelf: "end" }}><button className="primary"><UserPlus size={16} /> Új dolgozó</button></div>
        </form>
      )}

      {people.length === 0 && <p className="muted">Még nincs dolgozó. A társas vállalkozó tagot (pl. ügyvezető) is itt vedd fel, „Társas vállalkozó” jogviszonnyal.</p>}

      {people.map((p) => {
        const active = p.employments.filter((e) => e.startDate <= t && (!e.endDate || e.endDate >= t));
        return (
          <section key={p.id} id={`emp-${p.id}`} className="card" style={{ marginBottom: 14 }}>
            <div className="fc-head">
              <div>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                <span className="muted small">{[p.position, p.taxId ? `adóazonosító: ${p.taxId}` : null].filter(Boolean).join(" · ") || "—"}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {active.length ? active.map((e) => <span key={e.id} className="badge posted">{KIND_SHORT[e.kind as EmploymentKind]}</span>) : <span className="badge">nincs élő jogviszony</span>}
              </div>
            </div>

            {p.employments.map((e) => (
              <details key={e.id} style={{ marginTop: 10 }}>
                <summary>
                  {KIND_LABEL[e.kind as EmploymentKind]} · {fmtDate(e.startDate)} – {e.endDate ? fmtDate(e.endDate) : "határozatlan"} ·{" "}
                  {isEfo(e.kind as EmploymentKind) ? `${fmtHuf(Number(e.dailyWage))} Ft / nap` : `${fmtHuf(Number(e.monthlyWage))} Ft / hó`}
                  {e.guaranteedMin ? " · garantált bérminimum" : ""}
                </summary>
                <EmploymentForm cid={cid} employeeId={p.id} e={e} canWrite={canWrite} />
                {canWrite && (
                  <form action={deleteEmploymentAction} style={{ marginTop: 6 }}>
                    <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={e.id} />
                    <ConfirmButton message="Törlöd ezt a jogviszonyt? (Könyvelt hónap esetén nem lehet – add meg a megszűnés dátumát.)">Jogviszony törlése</ConfirmButton>
                  </form>
                )}
              </details>
            ))}

            {canWrite && (
              <details style={{ marginTop: 10 }} open={p.employments.length === 0}>
                <summary>+ Új jogviszony</summary>
                <EmploymentForm cid={cid} employeeId={p.id} canWrite={canWrite} />
              </details>
            )}

            {canWrite && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted small">Adatok szerkesztése / törlés</summary>
                <form action={saveEmployeeAction} className="form-grid" style={{ marginTop: 8 }}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={p.id} />
                  <label>Név<input name="name" defaultValue={p.name} required /></label>
                  <label>Adóazonosító jel<input name="taxId" defaultValue={p.taxId ?? ""} /></label>
                  <label>Munkakör<input name="position" defaultValue={p.position ?? ""} /></label>
                  <label>Megjegyzés<input name="note" defaultValue={p.note ?? ""} /></label>
                  <div className="row" style={{ alignSelf: "end" }}><button>Mentés</button></div>
                </form>
                <form action={deleteEmployeeAction} style={{ marginTop: 6 }}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={p.id} />
                  <ConfirmButton message={`Törlöd ${p.name} adatait és jogviszonyait?`}>Dolgozó törlése</ConfirmButton>
                </form>
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}
