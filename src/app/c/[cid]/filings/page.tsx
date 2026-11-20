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
import { payrollExportRows, template2608 } from "@/lib/payroll-2608-data";
import { deleteFilingAction, fillPartnerTaxAction, markLatestAction, markSubmittedAction, uploadFilingsAction } from "./actions";
import { isDate } from "@/lib/dates";
import { vatPlan, type PlanRow } from "@/lib/vat-return-data";
import { mSheetCheck } from "@/lib/mlap-check";

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
  const tab = sp.tab === "payroll" ? "payroll" : sp.tab === "revise" ? "revise" : "vat";
  if (tab === "revise") return <RevisePage cid={cid} sp={sp} companyName={company.name} canWrite={canWrite} />;
  if (sp.tab === "mcheck") return <MCheckPage cid={cid} sp={sp} companyName={company.name} />;
  const o = await filingsOverview(cid);
  const hasTemplate = tab === "payroll" && !!(await template2608(cid));
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
          <span className="muted">{company.name} · ÁFA- és járulékbevallás havonta · ÁNYK mentések betöltése, beküldött változatok, határidők</span>
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
          <Link className={tab === "vat" ? "on" : undefined} href="?tab=vat">ÁFA-bevallás</Link>
          <Link className={tab === "payroll" ? "on" : undefined} href="?tab=payroll">Járulékbevallás</Link>
          <Link href={tab === "payroll" ? "?tab=revise&kind=payroll" : "?tab=revise&kind=vat"}>ÁNYK Export</Link>
          <Link href="?tab=mcheck">M-lap ellenőrzés</Link>
        </div>
        {canWrite && rows.some((r) => r.versions.length) && (
          <form action={markLatestAction}>
            <input type="hidden" name="cid" value={cid} /><input type="hidden" name="tab" value={tab} />
            <ConfirmButton className="btn" message="Minden hónapban a legutolsó mentett változatot jelölöm beküldöttnek (a többi jelölés lekerül). Mehet?" pendingText="Jelölés…">Mindenhol a legutolsó ment be</ConfirmButton>
          </form>
        )}
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
                            {hasTemplate && (toNav > 0) && <div style={{ marginTop: 4 }}><a className="btn" href={`/c/${cid}/filings/payroll/${r.period}/xml`}><FileDown size={13} /> XML</a></div>}
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
          {hasTemplate
            ? <>A 2608 XML a cég legutóbb betöltött 2608 bevallásának mintájára készül (személyes adatok, jogviszony-kód, FEOR onnan), az időszak és az összegek a Bérszámfejtésből. Új dolgozónál előbb töltsd ki egyszer az ÁNYK-ban, és töltsd be a <code>.frm.enyk</code>-t.</>
            : <>A 2608 XML-exportjához tölts be egy, a cégnél az ÁNYK-ban kitöltött 2608 <code>.frm.enyk</code>-t – abból készül a többi hónap. Addig a fenti összegek a Bérszámfejtés paraméterei szerint (társas vállalkozó: minimum járulékalap) számolódnak.</>}
        </p>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        „Beküldött” = ez a változat ment be a NAV-hoz (az ÁNYK elküldött KR-állományai vagy a NAV érkeztetési igazolása alapján). Időszakonként a legutolsó
        beküldött változat a mérvadó – ehhez képest számol az önellenőrzés. Az XML az ÁNYK-ban a Szerviz › Egyedi importálás menüvel tölthető be, beküldésre az Adatok › XML állomány ellenőrzése és átadása elektronikus beküldésre (Ctrl+D) jelöli meg.
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

// --- ÁNYK Export: ÁFA-bevallás és önellenőrzés az ERP-ből ----------------------------------------------------------------------

const kft = (n: number | null | undefined) => (n == null ? "–" : fmtHuf(n));
const res = (r: PlanRow["prev"]) => !r ? "–" : r["84"]?.c ? `fiz. ${fmtHuf(r["84"].c)}` : r["86"]?.c ? `átv. ${fmtHuf(r["86"].c)}` : "0";
const ROW_LABEL: Record<string, string> = {
  "05": "05 – 5% értékesítés", "06": "06 – 18% értékesítés", "07": "07 – 27% értékesítés (általános)", "09": "09 – különös szabályok (különbözeti)",
  "12": "12 – KBB 5%", "13": "13 – KBB 18%", "14": "14 – KBB 27%", "36": "36 – fizetendő összesen", "50": "50 – használt cikk (a 09-ből)",
  "64": "64 – levonható 5%", "65": "65 – levonható 18%", "66": "66 – levonható 27%", "69": "69 – KBB levonható", "76": "76 – levonható összesen",
  "82": "82 – előző időszakról áthozott", "83": "83 – különbözet", "84": "84 – befizetendő", "85": "85 – visszaigényelt", "86": "86 – átvihető",
};

/** ÁNYK Export: szűrő (ÁFA-bevallás / Járulékbevallás), egy helyről letölthető XML-ek és ZIP. */
function ExportKindFilter({ kind }: { kind: "vat" | "payroll" }) {
  return (
    <div className="row no-print" style={{ marginBottom: 12 }}>
      <span className="muted">Mit exportálsz?</span>
      <div className="segmented" role="tablist" aria-label="Export">
      <Link className={kind === "vat" ? "on" : undefined} href="?tab=revise&kind=vat">ÁFA-bevallás</Link>
      <Link className={kind === "payroll" ? "on" : undefined} href="?tab=revise&kind=payroll">Járulékbevallás</Link>
      </div>
    </div>
  );
}

async function PayrollExportPage({ cid, companyName }: { cid: number; companyName: string }) {
  const [rows, tpl] = await Promise.all([payrollExportRows(cid), template2608(cid)]);
  const todo = rows.filter((r) => r.todo);
  const total = todo.reduce((a, r) => a + r.toNav, 0);
  const t = today();
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁNYK Export</h1>
          <span className="muted">{companyName} · 2608 havi járulékbevallás a Bérszámfejtésből, a betöltött ÁNYK-minta alapján</span>
        </div>
        <div className="row"><Link className="btn" href="?tab=payroll">← Járulékbevallás</Link></div>
      </div>
      <ExportKindFilter kind="payroll" />
      <div className="grid cols-4 lp-kpi">
        <div className="card stat"><div className="label">Beküldendő</div><div className="value">{todo.length}<small>hónap</small></div></div>
        <div className="card stat"><div className="label">Befizetendő összesen</div><div className="value">{fmtHuf(total)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Minta (ÁNYK)</div><div className="value" style={{ fontSize: 16 }}>{tpl ? `${tpl.periodFrom.slice(0, 7)} · ${tpl.form}` : "nincs"}</div></div>
        <div className="card stat"><div className="label">Hónapok jogviszonnyal</div><div className="value">{rows.length}<small>hónap</small></div></div>
      </div>
      {!tpl && (
        <div className="card" style={{ borderColor: "var(--warn)", marginBottom: 14 }}>
          <CircleAlert size={16} style={{ verticalAlign: -2 }} /> Nincs betöltött 2608 minta. Töltsd ki egy hónapra az ÁNYK-ban, mentsd el, és töltsd be a <code>.frm.enyk</code>-t a NAV-bevallások oldalon – abból készül a többi hónap.
        </div>
      )}
      <p className="muted no-print" style={{ margin: "0 0 8px" }}>
        Beküldés: ÁNYK › Adatok › XML állomány ellenőrzése és átadása elektronikus beküldésre (Ctrl+D), majd a szokásos közvetlen beküldés.
      </p>
      <div className="row card no-print" style={{ marginBottom: 12 }}>
        {tpl && todo.length > 0
          ? <a className="btn primary" href={`/c/${cid}/filings/export/zip?kind=payroll`}><FileDown size={14} /> Összes beküldendő (ZIP)</a>
          : <span className="muted">{tpl ? "Nincs beküldendő hónap." : "A ZIP a minta betöltése után érhető el."}</span>}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Időszak</th><th>Határidő</th><th>Állapot</th><th>Személyek</th><th className="num">TB-járulék</th><th className="num">Szocho</th><th className="num">SZJA</th><th className="num">Befizetendő</th><th>Teendő</th></tr></thead>
          <tbody>
            {[...rows].reverse().map((r) => {
              const st = STATUS[r.status];
              return (
                <tr key={r.period}>
                  <td><b>{label(r.period)}</b><div className="muted" style={{ fontSize: 12 }}>{r.form}</div></td>
                  <td className={r.due < t && r.todo ? "neg" : undefined}>{fmtDate(r.due)}</td>
                  <td><span className={`badge ${st.cls}`}>{st.text}</span></td>
                  <td>{r.pm?.people.map((p) => p.name).join(", ") ?? "–"}</td>
                  <td className="num">{r.pm ? fmtHuf(r.pm.totals.tb + r.pm.totals.tbCompany) : "–"}</td>
                  <td className="num">{r.pm ? fmtHuf(r.pm.totals.szocho) : "–"}</td>
                  <td className="num">{r.pm ? fmtHuf(r.pm.totals.szja) : "–"}</td>
                  <td className="num"><b>{fmtHuf(r.toNav)}</b></td>
                  <td>{tpl && r.toNav > 0 && r.status !== "upcoming"
                    ? <a className="btn" href={`/c/${cid}/filings/payroll/${r.period}/xml`}><FileDown size={13} /> XML</a>
                    : <span className="muted">{r.status === "upcoming" ? "folyó hónap" : "–"}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        A ZIP-ben a még be nem küldött (hiányzó vagy esedékes) hónapok vannak, időrendben. Fizetéses jogviszonynál (bér, SZJA) a minta még csak a TB-járulékot és a szochót tölti – ilyen dolgozónál az első hónapot töltsd ki az ÁNYK-ban.
      </p>
    </>
  );
}

async function RevisePage({ cid, sp, companyName, canWrite }: { cid: number; sp: Record<string, string>; companyName: string; canWrite: boolean }) {
  if (sp.kind === "payroll") return <PayrollExportPage cid={cid} companyName={companyName} />;
  const date = isDate(sp.date) ? sp.date : today();
  const place = sp.place ?? "";
  const { rows } = await vatPlan(cid, date);
  const todo = rows.filter((r) => r.mode !== "same");
  const extra = todo.reduce((a, r) => a + ((r.next["84"]?.c ?? 0) - (r.next["86"]?.c ?? 0)) - ((r.prev?.["84"]?.c ?? 0) - (r.prev?.["86"]?.c ?? 0)), 0);
  const surcharge = todo.reduce((a, r) => a + r.surcharge.amount, 0);
  const warnings = [...new Set(rows.flatMap((r) => r.computed.warnings.map((w) => `${label(r.period)}: ${w}`)))];
  const unconfirmed = rows.filter((r) => r.base && !r.base.confirmed).length;
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ tab: "revise", date, ...(place ? { place } : {}), ...o })}`;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁNYK Export</h1>
          <span className="muted">{companyName} · a könyvelt számlákból számolt bevallás a beküldött változathoz képest, időrendben láncolva</span>
        </div>
        <div className="row"><Link className="btn" href="?tab=mcheck">M-lap ellenőrzés</Link><Link className="btn" href="?tab=vat">← ÁFA-bevallás</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <ExportKindFilter kind="vat" />
      <div className="grid cols-4 lp-kpi">
        <div className="card stat"><div className="label">Önellenőrzendő / új</div><div className="value">{todo.length}<small>hónap</small></div></div>
        <div className="card stat"><div className="label">Egyenleg-változás (e Ft)</div><div className="value" style={extra > 0 ? { color: "var(--neg)" } : undefined}>{extra > 0 ? "+" : ""}{fmtHuf(extra)}<small>e Ft</small></div></div>
        <div className="card stat"><div className="label">Önellenőrzési pótlék</div><div className="value">{fmtHuf(surcharge)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Beküldés nem jelölve</div><div className="value">{unconfirmed}<small>hónap</small></div></div>
      </div>

      <p className="muted no-print" style={{ margin: "0 0 8px" }}>
        Beküldés: ÁNYK › Adatok › XML állomány ellenőrzése és átadása elektronikus beküldésre (Ctrl+D), majd a szokásos közvetlen beküldés. Szerkesztéshez: Szerviz › Egyedi importálás. A „Számított mezők újraszámítása” nem kell.
      </p>
      <form className="row card no-print" style={{ marginBottom: 12, alignItems: "flex-end" }}>
        <input type="hidden" name="tab" value="revise" />
        <label>Benyújtás napja (pótlék eddig)<input type="date" name="date" defaultValue={date} /></label>
        <label>Aláírás helye<input name="place" defaultValue={place} placeholder="a beadott bevallásból" /></label>
        <button>Újraszámolás</button>
        <a className="btn primary" href={`/c/${cid}/filings/export/zip${q({ kind: "vat" }).replace("?tab=revise&", "?")}`}><FileDown size={14} /> Összes XML (ZIP)</a>
        {canWrite && (
          <span>
            <button formAction={fillPartnerTaxAction} formMethod="post" name="cid" value={cid} className="btn" title="A beadott M-lapokról a partnerek törzsszáma">Partner-adószámok az M-lapokról</button>
          </span>
        )}
      </form>

      {warnings.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)", marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}><CircleAlert size={16} style={{ verticalAlign: -2 }} /> Ellenőrizendő</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Időszak</th><th>Mérvadó beadott</th><th>Beadott (e Ft)</th><th>ERP szerint (e Ft)</th><th>Pótlék</th><th>Teendő</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td><b>{label(r.period)}</b><div className="muted" style={{ fontSize: 12 }}>{r.form} · határidő {fmtDate(r.due)}</div></td>
                <td>{r.base ? <>{KIND_LABEL[r.base.kind]}<div className="muted" style={{ fontSize: 12 }}>mentve {r.base.savedAt}{r.base.confirmed ? "" : " · nem jelölt"}</div></> : <span className="badge overdue">nincs beadva</span>}</td>
                <td>{res(r.prev)}</td>
                <td><b>{res(r.next)}</b>{r.next["82"]?.c ? <div className="muted" style={{ fontSize: 12 }}>áthozott {kft(r.next["82"].c)}</div> : null}</td>
                <td>{r.mode === "self_revision" ? (r.surcharge.amount ? <>{fmtHuf(r.surcharge.amount)} Ft<div className="muted" style={{ fontSize: 12 }}>alap {kft(r.surcharge.baseK)} e Ft · {r.surcharge.days} nap{r.repeated ? " · ismételt (×1,5)" : ""}{r.surcharge.chainReduced ? " · göngyölítés (05)" : ""}</div></> : "0") : "–"}</td>
                <td>
                  {r.mode === "same" ? <span className="badge posted"><CircleCheck size={11} /> egyezik</span> : (
                    <>
                      <a className="btn" href={`/c/${cid}/filings/vat/${r.period}/xml?${new URLSearchParams({ date, ...(place ? { place } : {}) })}`}><FileDown size={13} /> {r.mode === "original" ? "Eredeti XML" : "Önellenőrzés XML"}</a>
                      <details style={{ marginTop: 4 }}>
                        <summary className="muted" style={{ fontSize: 12 }}>{r.diffRows.length} eltérő sor{r.computed.partners.length ? ` · ${r.computed.partners.length} M-lap` : ""}</summary>
                        <table style={{ fontSize: 12 }}>
                          <thead><tr><th>Sor</th><th className="num">Beadott b</th><th className="num">Beadott c</th><th className="num">ERP b</th><th className="num">ERP c</th></tr></thead>
                          <tbody>{r.diffRows.map((d) => <tr key={d.row}><td>{ROW_LABEL[d.row] ?? d.row}</td><td className="num">{kft(d.prevB)}</td><td className="num">{kft(d.prevC)}</td><td className="num">{kft(d.nextB)}</td><td className="num"><b>{kft(d.nextC)}</b></td></tr>)}</tbody>
                        </table>
                      </details>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Az önellenőrzés a 82–86. sor „b” oszlopába a mérvadó beadott változat értékeit, a „c” oszlopba a helyes (ERP szerinti) értékeket írja; a 04. lapon
        a pótlékalap, a pótlék (a jegybanki alapkamat 365-öd része naponta, ismételt önellenőrzésnél másfélszerese), a kötelezettség növekedése / csökkenése.
        A különbözeti adózás a 09. sorba kerül, kiemelve az 50. sorban. Az ÁNYK-ban importálás után futtasd le az ellenőrzést; a ZIP-ben a fájlok időrendben
        vannak – ebben a sorrendben kell beküldeni.
      </p>
    </>
  );
}

// --- M-lap ellenőrzés ------------------------------------------------------------------------------------

const KIND_HU: Record<string, string> = { normal: "levonható", non_deductible: "nem levonható", out_of_scope: "TAH", exempt: "adómentes", margin: "különbözeti", eu_acquisition: "KBB", reverse_charge: "fordított" };

async function MCheckPage({ cid, sp, companyName }: { cid: number; sp: Record<string, string>; companyName: string }) {
  const c = await mSheetCheck(cid);
  const nd = c.issues.filter((i) => i.type === "not_deductible");
  const mm = c.issues.filter((i) => i.type === "number_mismatch");
  const miss = c.issues.filter((i) => i.type === "missing");
  const ft = (n: number) => fmtHuf(Math.round(n));
  const invLink = (id: number, label: string) => <Link href={`/c/${cid}/invoices/${id}`}>{label}</Link>;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>M-lap ellenőrzés</h1>
          <span className="muted">{companyName} · a beadott M-lapok {c.submittedCount} számlája az ERP könyvelésével összevetve, és az M-laphoz hiányzó adatok</span>
        </div>
        <div className="row"><Link className="btn" href="?tab=revise">ÁNYK Export</Link><Link className="btn" href="?tab=vat">← ÁFA-bevallás</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid cols-4 lp-kpi">
        <div className="card stat"><div className="label">Partner adószám nélkül</div><div className="value" style={c.missingTax.length ? { color: "var(--neg)" } : undefined}>{c.missingTax.length}<small>partner</small></div></div>
        <div className="card stat"><div className="label">Számlaszám eltér</div><div className="value">{mm.length}<small>számla</small></div></div>
        <div className="card stat"><div className="label">Korábban levonva, ERP-ben nem levonható</div><div className="value">{nd.length}<small>számla</small></div></div>
        <div className="card stat"><div className="label">Nincs meg az ERP-ben</div><div className="value">{miss.length}<small>számla</small></div></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>1. Levonható áfa adószám nélküli partnertől</h3>
        <p className="muted" style={{ marginTop: 0 }}>Ezek a számlák nem kerülhetnek M-lapra, amíg a partnernek nincs adószáma (Partnerek › szerkesztés). Külföldi (OSS) eladónál a magyar áfa általában nem vonható le.</p>
        {c.missingTax.length === 0 ? <p className="muted">Nincs ilyen partner.</p> : (
          <table><thead><tr><th>Partner</th><th className="num">Számla</th><th className="num">Levonható áfa</th></tr></thead>
            <tbody>{c.missingTax.map((p) => <tr key={p.partnerId}><td><Link href={`/c/${cid}/partners`}>{p.name}</Link></td><td className="num">{p.invoices}</td><td className="num">{ft(p.vat)} Ft</td></tr>)}</tbody></table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>2. Számlaszám-eltérés (beadott M-lap ↔ ERP)</h3>
        <p className="muted" style={{ marginTop: 0 }}>Ugyanaz a számla (partner és összeg alapján) más számlaszámmal. A helyes az, ami az eredeti számlán áll – ha az ERP-ben rossz, javítsd a számlán; ha a beadott M-lapon volt rossz, az önellenőrzés az ERP szerintit küldi be.</p>
        {mm.length === 0 ? <p className="muted">Nincs eltérés.</p> : (
          <table style={{ fontSize: 13 }}><thead><tr><th>Időszak</th><th>Beadott M-lapon</th><th>ERP-ben</th><th>Partner</th><th className="num">Áfa</th><th>Egyezés</th></tr></thead>
            <tbody>{mm.map((i, k) => i.type === "number_mismatch" && <tr key={k}><td>{label(i.sub.period)}</td><td><code>{i.sub.number}</code></td><td><code>{invLink(i.erp.id, i.erp.number || "(üres)")}</code></td><td>{i.erp.partnerName}</td><td className="num">{ft(i.sub.vat)}</td><td className="muted">{i.hint}</td></tr>)}</tbody></table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>3. Korábban levonva – az ERP-ben nem levonható</h3>
        <p className="muted" style={{ marginTop: 0 }}>A beadott bevallásban levont áfa, az ERP-ben nem levonható (27NL), TAH vagy adómentes kóddal. Számlánként érdemes megnézni: vegyes számlánál (pl. hatósági díj + szolgáltatás) a szolgáltatás áfája levonható lehet.</p>
        {nd.length === 0 ? <p className="muted">Nincs ilyen számla.</p> : (
          <table style={{ fontSize: 13 }}><thead><tr><th>Időszak</th><th>Számla</th><th>Partner</th><th>ERP-kód</th><th className="num">Korábban levont áfa</th></tr></thead>
            <tbody>{nd.map((i, k) => i.type === "not_deductible" && <tr key={k}><td>{label(i.sub.period)}</td><td><code>{invLink(i.erp.id, i.erp.number)}</code></td><td>{i.erp.partnerName}</td><td>{i.erp.kinds.map((x) => KIND_HU[x] ?? x).join(", ")}</td><td className="num">{ft(i.sub.vat)} Ft</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>Összesen</td><td className="num"><b>{ft(nd.reduce((a, i) => a + i.sub.vat, 0))} Ft</b></td></tr></tfoot></table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>4. A beadott M-lapon szerepel, az ERP-ben nincs meg</h3>
        <p className="muted" style={{ marginTop: 0 }}>Se számlaszám, se partner + összeg alapján nincs párja. Vagy hiányzik a könyvelésből, vagy a régi bevallásban szerepelt tévesen.</p>
        {miss.length === 0 ? <p className="muted">Nincs ilyen számla.</p> : (
          <table style={{ fontSize: 13 }}><thead><tr><th>Időszak</th><th>Számla</th><th>Partner (törzsszám)</th><th>Teljesítés</th><th className="num">Adóalap</th><th className="num">Áfa</th></tr></thead>
            <tbody>{miss.map((i, k) => <tr key={k}><td>{label(i.sub.period)}</td><td><code>{i.sub.number}</code></td><td>{i.sub.partnerName} ({i.sub.tax8})</td><td>{fmtDate(i.sub.date)}</td><td className="num">{ft(i.sub.base)}</td><td className="num">{ft(i.sub.vat)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={5}>Összesen</td><td className="num"><b>{ft(miss.reduce((a, i) => a + i.sub.vat, 0))} Ft</b></td></tr></tfoot></table>
        )}
      </div>
    </>
  );
}
