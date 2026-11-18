import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { customizedYears, getParams } from "@/lib/payroll";
import { PARAM_LABELS, defaultParams } from "@/lib/payroll-calc";
import { today } from "@/lib/dates";
import { saveParamsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Évenkénti bérparaméterek – minden cégre érvényesek. A beépített alapértékeket írják felül. */
export default async function PayrollParamsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const year = Number(sp.year) || Number(today().slice(0, 4));
  const [p, custom] = await Promise.all([getParams(year), customizedYears()]);
  const def = defaultParams(year);
  const canWrite = role === "owner";
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Bérparaméterek – {year}</h1>
          <span className="muted">Minden cégre érvényes · {custom.includes(year) ? "módosított értékek" : "beépített alapértékek"}</span>
        </div>
        <Link className="btn" href={`/c/${cid}/payroll?period=${year}-${today().slice(5, 7)}`}>← Bértábla</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card" style={{ marginBottom: 12 }}>
        <label>Év<input type="number" name="year" defaultValue={year} min={2020} max={2100} style={{ width: 100 }} /></label>
        <button style={{ alignSelf: "end" }}>Megnyitás</button>
      </form>
      <form action={saveParamsAction} className="card">
        <input type="hidden" name="cid" value={cid} /><input type="hidden" name="year" value={year} />
        <table className="cv-calc">
          <tbody>
            {PARAM_LABELS.map(({ key, label, unit }) => (
              <tr key={key}>
                <td>{label}{String(p[key]) !== String(def[key]) && <div className="muted small">alapérték: {String(def[key])} {unit}</div>}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <input name={key} defaultValue={String(p[key])} inputMode={typeof def[key] === "number" ? "decimal" : "text"} disabled={!canWrite} style={{ width: 130, textAlign: "right" }} /> <span className="muted small">{unit}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canWrite ? <div className="row" style={{ marginTop: 12 }}><button className="primary">Mentés</button></div> : <p className="muted small">A paramétereket csak tulajdonos módosíthatja.</p>}
        <p className="muted small">A kedvezmények (családi, 25 év alatti, anyák) és a jelenléti naptár a következő fázisban jönnek.</p>
      </form>
    </>
  );
}
