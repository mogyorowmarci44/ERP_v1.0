import Link from "next/link";
import { CircleCheck, CircleAlert, FileDown, Link2Off } from "lucide-react";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtDate, today } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";
import { KIND_LABEL, type VatResult } from "@/lib/anyk";
import { filingsOverview, type FilingVersion, type PeriodRow } from "@/lib/filings";
import { deleteFilingAction, markSubmittedAction, uploadFilingsAction } from "./actions";

export const dynamic = "force-dynamic";

const MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const label = (p: string) => `${p.slice(0, 4)}. ${MONTH[Number(p.slice(5, 7)) - 1]}`;
const ft = (n: number) => `${fmtHuf(n)} Ft`;

/** ÁFA-eredmény röviden (ezer Ft): befizetendő vagy átvihető, az előző időszakról áthozottal. */
function vatText(v: VatResult | null) {
  if (!v) return "–";
  const main = v.payable ? `fizetendő ${fmtHuf(v.payable)}` : v.refund ? `visszaigényelt ${fmtHuf(v.refund)}` : v.carry ? `átvihető ${fmtHuf(v.carry)}` : "0";
  return `${main} e Ft${v.prevCarry ? ` · áthozott ${fmtHuf(v.prevCarry)}` : ""}`;
}

const STATUS: Record<PeriodRow["status"], { cls: string; text: string }> = {
  ok: { cls: "posted", text: "beküldve" },
  unconfirmed: { cls: "soon", text: "beküldés nem jelölve" },
  missing: { cls: "overdue", text: "hiányzik" },
  due: { cls: "soon", text: "esedékes" },
  upcoming: { cls: "draft", text: "folyó hónap" },
};

/** NAV-bevallások: ÁNYK mentett nyomtatványok nyilvántartása, határidők, ÁFA átviteli lánc, 2608 adatok a bérmodulból. */
export default async function FilingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const tab = sp.tab === "payroll" ? "payroll" : "vat";
  const o = await filingsOverview(cid);
  const t = today();
  const rows = tab === "vat" ? o.vat : o.payroll;
  const missing = rows.filter((r) => r.status === "missing" || r.status === "due").length;
  const unconfirmed = rows.filter((r) => r.status === "unconfirmed").length;
  const chainBy = new Map(o.chain.map((c) => [c.period, c]));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>NAV-bevallások (ÁNYK)</h1>
          <span className="muted">{company.name} · ÁFA (2565 / 2665) és járulék (2608) havonta · ÁNYK mentések betöltése, beküldött változatok, határidők</span>
        </div>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/payroll`}>Bérszámfejtés</Link>
          <Link className="btn" href={`/c/${cid}/reports/vat`}>ÁFA analitika</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid cols-4 lp-kpi">
        <div className="card stat"><div className="label">Hiányzó / esedékes</div><div className="value" style={missing ? { color: "var(--neg)" } : undefined}>{missing}<small>hónap</small></div></div>
        <div className="card stat"><div className="label">Beküldés nem jelölve</div><div className="value">{unconfirmed}<small>hónap</small></div></div>
        <div className="card stat"><div className="label">Átviteli lánc hiba (ÁFA)</div><div className="value" style={o.chain.length ? { color: "var(--neg)" } : undefined}>{o.chain.length}<small>hely</small></div></div>
        <div className="card stat"><div className="label">Betöltött változat</div><div className="value">{o.count}<small>db</small></div></div>
      </div>

      {canWrite && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>ÁNYK mentések betöltése</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Az ÁNYK <code>abevjava/mentesek</code> mappájának <code>.frm.enyk</code> fájljai (vagy egy ZIP az egész mappáról). Csak a cég saját
            ÁFA- és járulékbevallásai kerülnek be, a többit (TAO, HIPA, más cég) a betöltés kihagyja. Ugyanaz a fájl kétszer nem töltődik be.
          </p>
          <form action={uploadFilingsAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="cid" value={cid} />
            <label>Fájlok<input type="file" name="files" multiple accept=".enyk,.xml,.zip" required /></label>
            <SubmitButton className="primary" pendingText="Betöltés…">Betöltés</SubmitButton>
          </form>
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="segmented" role="tablist" aria-label="Bevallás">
          <Link className={tab === "vat" ? "on" : undefined} href="?tab=vat">ÁFA (2565 / 2665)</Link>
          <Link className={tab === "payroll" ? "on" : undefined} href="?tab=payroll">Járulék (2608)</Link>
        </div>
      </div>

      {tab === "vat" && o.chain.length > 0 && (
        <div className="card" style={{ borderColor: "var(--neg)", marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}><Link2Off size={16} style={{ verticalAlign: -2 }} /> Átviteli lánc: az előző havi átvihető követelés nem jelenik meg a következő hónapban</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {o.chain.map((c) => (
              <li key={c.period}>
                <b>{label(c.period)}</b>: a(z) {label(c.prevPeriod)} 86. sora szerint <b>{fmtHuf(c.expected)} e Ft</b> átvihető, a 82. sorban {c.found == null ? "nincs összeg" : <b>{fmtHuf(c.found)} e Ft</b>} szerepel.
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginBottom: 0 }}>A mérvadó változatok alapján (beküldöttnek jelölt, ennek híján a legutolsó mentés). Az önellenőrzésnél időrendben kell végigvinni.</p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>
          {tab === "vat" ? "Még nincs bizonylat és betöltött ÁFA-bevallás." : "Nincs élő jogviszony a Bérszámfejtésben – a 2608 azokra a hónapokra kell, amikor van biztosított (pl. társas vállalkozó minimumjárulékkal)."}
        </p></div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Időszak</th><th>Nyomtatvány</th><th>Határidő</th><th>Állapot</th>
                <th>{tab === "vat" ? "Mérvadó változat" : "Bérmodul szerint (NAV felé)"}</th>
                <th>Változatok</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status];
                const pm = o.payrollMonths[r.period];
                const toNav = pm ? pm.totals.szja + pm.totals.tb + pm.totals.tbCompany + pm.totals.szocho : 0;
                return (
                  <tr key={r.period}>
                    <td><b>{label(r.period)}</b>{chainBy.has(r.period) && <> <span className="badge overdue" title="Átviteli lánc hiba"><Link2Off size={11} /> lánc</span></>}</td>
                    <td>{r.form}</td>
                    <td className={r.due < t && r.status !== "ok" && r.status !== "unconfirmed" ? "neg" : undefined}>{fmtDate(r.due)}</td>
                    <td><span className={`badge ${st.cls}`}>{r.status === "ok" ? <CircleCheck size={11} /> : r.status === "missing" ? <CircleAlert size={11} /> : null} {st.text}</span></td>
                    <td>
                      {tab === "vat"
                        ? (r.effective ? <>{KIND_LABEL[r.effective.kind]} · {vatText(r.effective.vat)}<div className="muted" style={{ fontSize: 12 }}>mentve {r.effective.savedAt ?? "–"}{r.confirmed ? "" : " · nem megerősített"}</div></> : <span className="muted">–</span>)
                        : (pm ? <>
                            <div>{pm.people.map((p) => p.name).join(", ")}</div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              bruttó {ft(pm.totals.gross)} · SZJA {ft(pm.totals.szja)} · TB {ft(pm.totals.tb + pm.totals.tbCompany)}{pm.totals.tbCompany ? ` (ebből a cég viseli ${ft(pm.totals.tbCompany)})` : ""} · szocho {ft(pm.totals.szocho)}
                            </div>
                            <div><b>Befizetendő: {ft(toNav)}</b> · {pm.runStatus === "posted" ? "könyvelve" : pm.runStatus === "external" ? "kézzel könyvelve" : <Link href={`/c/${cid}/payroll?period=${r.period}`}>nincs könyvelve</Link>}</div>
                          </> : <span className="muted">–</span>)}
                    </td>
                    <td>
                      {r.versions.length === 0 ? <span className="muted">nincs</span> : (
                        <details>
                          <summary>{r.versions.length} változat</summary>
                          <Versions cid={cid} tab={tab} versions={r.versions} canWrite={canWrite} />
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payroll" && (
        <p className="muted" style={{ marginTop: 10 }}>
          A 2608 XML-exportjához a nyomtatvány mezőkódjai kellenek: tölts be egy már beadott 2608 <code>.frm.enyk</code>-t (bármelyik cégnél) –
          abból készül a kitöltés. Addig a fenti összegek a Bérszámfejtés paraméterei szerint (társas vállalkozó: minimum járulékalap) számolódnak.
        </p>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        „Beküldött” = ez a változat ment be a NAV-hoz (az ÁNYK elküldött KR-állományai vagy a NAV érkeztetési igazolása alapján). Időszakonként a legutolsó
        beküldött változat a mérvadó – ehhez képest számol az önellenőrzés. Az XML az ÁNYK-ban az Adatok › Import menüvel tölthető be.
      </p>
    </>
  );
}

function Versions({ cid, tab, versions, canWrite }: { cid: number; tab: string; versions: FilingVersion[]; canWrite: boolean }) {
  return (
    <table style={{ marginTop: 6, fontSize: 12.5 }}>
      <tbody>
        {[...versions].reverse().map((v) => (
          <tr key={v.id}>
            <td>
              <b>{KIND_LABEL[v.kind]}</b>{v.submitted && <> <span className="badge posted"><CircleCheck size={11} /> beküldve{v.receiptNo ? ` · ${v.receiptNo}` : ""}</span></>}
              <div className="muted">mentve {v.savedAt ?? "–"}{v.signedAt ? ` · aláírás ${fmtDate(v.signedAt)}` : ""}</div>
              {v.vat && <div>{vatText(v.vat)}</div>}
              <div className="muted">{Object.entries(v.sheetCounts).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join(", ")}</div>
              {v.krFileName && <div className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, wordBreak: "break-all" }}>{v.krFileName}</div>}
            </td>
            <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
              <a className="btn" href={`/c/${cid}/filings/${v.id}/xml`} title="ÁNYK-ba importálható XML"><FileDown size={13} /> XML</a>
              {canWrite && (
                <>
                  <form action={markSubmittedAction} style={{ display: "inline" }}>
                    <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={v.id} /><input type="hidden" name="tab" value={tab} />
                    <input type="hidden" name="on" value={v.submitted ? "0" : "1"} />
                    <SubmitButton className={v.submitted ? undefined : "primary"} pendingText="…">{v.submitted ? "Jelölés le" : "Ez ment be"}</SubmitButton>
                  </form>
                  <form action={deleteFilingAction} style={{ display: "inline" }}>
                    <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={v.id} /><input type="hidden" name="tab" value={tab} />
                    <ConfirmButton message="Törlöd ezt a változatot a nyilvántartásból? (Az ÁNYK-ban és a NAV-nál nem változik semmi.)" pendingText="…">Törlés</ConfirmButton>
                  </form>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
