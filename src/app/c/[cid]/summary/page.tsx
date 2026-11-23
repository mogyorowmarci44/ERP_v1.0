/** v3.9.2 – Napi összefoglaló e-mail: címzettek és változatuk cégenként, előnézet, próbaküldés. */
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { companySnapshot } from "@/lib/daily-summary/data";
import { renderCompanyMail, VARIANT_LABEL, type Variant } from "@/lib/daily-summary/render";
import { getSummarySettings, smtpConfigured } from "@/lib/daily-summary/send";
import { addRecipientAction, updateRecipientAction, testRecipientAction } from "./actions";

const VARIANTS = Object.keys(VARIANT_LABEL) as Variant[];
const SHORT: Record<Variant, string> = { ceo: "Ügyvezető", cfo: "Pénzügyes", full: "Teljes" };

export default async function SummaryPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [list, st] = await Promise.all([
    db.select().from(schema.summaryRecipients).where(eq(schema.summaryRecipients.companyId, cid)).orderBy(asc(schema.summaryRecipients.name)),
    getSummarySettings(),
  ]);
  const pv: Variant = VARIANTS.find((v) => v === sp.preview) ?? "ceo";
  let preview = "";
  let previewError = "";
  try {
    preview = renderCompanyMail(await companySnapshot(cid), pv).html;
  } catch (e) {
    previewError = e instanceof Error ? e.message : String(e);
  }
  const b = `/c/${cid}/summary`;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Napi összefoglaló e-mail</h1>
          <span className="muted">{company.name} · minden nap 6:59-kor · a tegnapi napról és a mai állapotról</span>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {!smtpConfigured() && (
        <div className="flash error">Az e-mail küldés még nincs beállítva: a Renderen kell megadni az SMTP_USER (Gmail cím) és SMTP_PASS (alkalmazásjelszó) változót. Addig az előnézet működik, a küldés nem.</div>
      )}
      {st.lastRun && (
        <p className="muted" style={{ fontSize: 13 }}>
          Utolsó kiküldés: {st.lastRun.date.replaceAll("-", ".")}. · {st.lastRun.sent} e-mail{st.lastRun.failed ? ` · ${st.lastRun.failed} hiba` : ""}
        </p>
      )}

      <h2>Címzettek ({list.length})</h2>
      <table>
        <thead><tr><th>Név</th><th>E-mail</th><th>Változat</th><th>Állapot</th><th></th></tr></thead>
        <tbody>
          {!list.length && <tr><td colSpan={5} className="muted">Még nincs címzett – lent vehetsz fel.</td></tr>}
          {list.map((r) => (
            <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
              <td>{r.name}</td>
              <td className="mono">{r.email}</td>
              <td>
                {canWrite ? (
                  <form action={updateRecipientAction} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} />
                    <select name="variant" defaultValue={r.variant}>{VARIANTS.map((v) => <option key={v} value={v}>{SHORT[v]}</option>)}</select>
                    <button>Mentés</button>
                  </form>
                ) : SHORT[r.variant as Variant] ?? r.variant}
              </td>
              <td>{r.active ? <span className="badge posted">kapja</span> : <span className="badge draft">szünetel</span>}</td>
              <td>
                {canWrite && (
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <form action={testRecipientAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} /><button title="Most küld egy próbát erre a címre">Próba</button></form>
                    <form action={updateRecipientAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="toggle" /><button>{r.active ? "Szünet" : "Újra"}</button></form>
                    <form action={updateRecipientAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="delete" /><button className="danger">Törlés</button></form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canWrite && (
        <form action={addRecipientAction} className="card form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="cid" value={cid} />
          <label>Név<input name="name" required placeholder="Mogyorósi Bálint" /></label>
          <label>E-mail<input name="email" type="email" required placeholder="nev@gmail.com" /></label>
          <label>Változat
            <select name="variant" defaultValue="ceo">{VARIANTS.map((v) => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}</select>
          </label>
          <div style={{ alignSelf: "end" }}><button className="primary">Címzett hozzáadása</button></div>
        </form>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        Ügyvezető: számok, teendők, autókészlet. Pénzügyes: számok, teendők, pénzügyi napló + a tegnapi napló CSV-ben. Teljes: mind a négy blokk.
        A holding összesítő e-mail címzettjeit az <Link href="/admin/summary">Admin › Napi összefoglaló</Link> oldalon lehet beállítani.
      </p>

      <h2 style={{ display: "flex", alignItems: "center", gap: 12 }}>
        Előnézet
        <span className="segmented" role="tablist">
          {VARIANTS.map((v) => <Link key={v} href={`${b}?preview=${v}`} className={v === pv ? "on" : undefined} role="tab" aria-selected={v === pv}>{SHORT[v]}</Link>)}
        </span>
      </h2>
      {previewError ? <div className="flash error">Az előnézet nem készült el: {previewError}</div> : (
        <iframe title="E-mail előnézet" srcDoc={preview} style={{ width: "100%", maxWidth: 680, height: 1100, border: "1px solid var(--line)", borderRadius: 12, background: "#eef1f5" }} />
      )}
    </>
  );
}
