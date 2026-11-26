import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { operatorParams } from "@/lib/legal-params";
import { LEGAL_PARAMS, history, resolveAt } from "@/lib/legal-params-calc";
import { saveLegalParamAction, deleteLegalParamAction } from "../actions";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { fmtDate, today } from "@/lib/dates";
import { fmtNum } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * v6.4.0 – Jogszabályi paraméterek (üzemeltető): minden paraméter teljes története, új érték dátumtól hatályosan.
 * Egy új érték minden ügyfélnél azonnal érvényes a hatálybalépés napjától.
 */
export default async function LegalParamsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const op = await operatorParams();
  const t = today();
  const groups = [...new Set(LEGAL_PARAMS.map((p) => p.group))];
  const nextYear = `${Number(t.slice(0, 4)) + 1}-01-01`;
  return (
    <div className="main" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Jogszabályi paraméterek</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin/platform">← Ügyfélfiókok</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted" style={{ marginTop: -4 }}>
        Az itt rögzített érték a megadott naptól <strong>minden ügyfélnél</strong> érvényes (bérszámfejtés a hónap utolsó napján, TAO az üzleti év
        utolsó napján hatályos értékkel). A beépített értékeket nem kell felvinni; új évnél elég a változó paramétereket megadni.
        Minden módosítás a tevékenységnaplóba kerül.
      </p>

      <h2>Új érték</h2>
      <form action={saveLegalParamAction} className="card form-grid">
        <label>Paraméter
          <select name="key" defaultValue={sp.key ?? "payroll.minWage"}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {LEGAL_PARAMS.filter((p) => p.group === g).map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Hatályos ettől<input type="date" name="validFrom" defaultValue={nextYear} required /></label>
        <label>Érték<input name="value" inputMode="decimal" required /></label>
        <label>Forrás / megjegyzés<input name="note" placeholder="pl. 2026. évi minimálbér-rendelet" /></label>
        <div style={{ alignSelf: "end" }}><button className="primary">Rögzítés</button></div>
      </form>

      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Paraméter</th><th className="num">Ma hatályos</th><th>Története</th></tr></thead>
              <tbody>
                {LEGAL_PARAMS.filter((p) => p.group === g).map((p) => {
                  const h = history(p.key, op);
                  const cur = resolveAt(h, t);
                  return (
                    <tr key={p.key}>
                      <td>{p.label}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{cur ? fmtNum(cur.value, { maximumFractionDigits: 4 }) : "–"} <span className="muted small">{p.unit}</span></td>
                      <td style={{ fontSize: 12.5 }}>
                        {h.map((x) => (
                          <div key={x.from} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                            <span>{fmtDate(x.from)}: <b>{fmtNum(x.value, { maximumFractionDigits: 4 })}</b> {p.unit}</span>
                            <span className="muted">{x.source === "builtin" ? "beépített" : "üzemeltető"}{x.note ? ` · ${x.note}` : ""}</span>
                            {x.source === "operator" && (
                              <form action={deleteLegalParamAction}>
                                <input type="hidden" name="key" value={p.key} />
                                <input type="hidden" name="validFrom" value={x.from} />
                                <ConfirmButton className="link" message={`Törlöd a(z) ${fmtDate(x.from)}-tól hatályos értéket? Minden ügyfélnél a korábbi / beépített érték lép a helyébe.`}>törlés</ConfirmButton>
                              </form>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>
        A gépjármű EPR-díjtételek dátumhatályos táblája és az önkormányzati HIPA-szabályok (Kincstár-letöltés) külön helyen vannak; az
        ÁFA-kulcsok cégenként, az ÁFA-kódoknál állíthatók.
      </p>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
