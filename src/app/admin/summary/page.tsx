/** v3.9.2 – Admin: holding napi összefoglaló (címzettek, előnézet, futásnapló, küldés most). */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { ErpLogo } from "@/components/Brand";
import { ConfirmButton } from "@/components/ConfirmButton";
import { APP_VERSION } from "@/lib/version";
import { holdingSnapshot } from "@/lib/daily-summary/data";
import { renderHoldingMail } from "@/lib/daily-summary/render";
import { getSummarySettings, recipientsByCompany, smtpConfigured } from "@/lib/daily-summary/send";
import { saveHoldingAction, testHoldingAction, runNowAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const [st, byCompany] = await Promise.all([getSummarySettings(), recipientsByCompany()]);
  const companyRecipients = [...byCompany.values()].reduce((s, l) => s + l.length, 0);
  let preview = "", previewError = "";
  try {
    preview = renderHoldingMail(await holdingSnapshot()).html;
  } catch (e) {
    previewError = e instanceof Error ? e.message : String(e);
  }
  const l = st.lastRun;
  return (
    <div className="main" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Napi összefoglaló – Holding</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link><Link href="/">Cégeim</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {!smtpConfigured() && <div className="flash error">Az e-mail küldés nincs beállítva: a Renderen add meg az SMTP_USER (Gmail cím) és SMTP_PASS (Gmail alkalmazásjelszó) változót.</div>}

      <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
        <form action={saveHoldingAction} className="card grid" style={{ gap: 10 }}>
          <strong>Holding e-mail címzettjei</strong>
          <span className="muted" style={{ fontSize: 13 }}>Minden cég adata benne van – csak a holding tulajdonosainak. Több cím vesszővel elválasztva.</span>
          <textarea name="emails" rows={2} defaultValue={st.holdingEmails.join(", ")} placeholder={me.email} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="enabled" defaultChecked={st.enabled} /> Napi küldés bekapcsolva (minden nap 6:59)</label>
          <div><button className="primary">Mentés</button></div>
        </form>
        <div className="card grid" style={{ gap: 8 }}>
          <strong>Küldés</strong>
          <span style={{ fontSize: 13 }}>
            Cégszintű címzettek: <b>{companyRecipients}</b> · Holding: <b>{st.holdingEmails.length}</b>
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {l ? <>Utolsó futás: {l.date.replaceAll("-", ".")}. ({l.trigger === "cron" ? "ütemezett" : "kézi"}) · {l.sent} elküldve{l.failed ? ` · ${l.failed} hiba` : ""}</> : "Még nem futott."}
          </span>
          {l?.errors.length ? <ul style={{ margin: 0, fontSize: 12.5, color: "var(--neg)" }}>{l.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
          <form action={testHoldingAction} className="row" style={{ gap: 6 }}>
            <input name="to" type="email" defaultValue={st.holdingEmails[0] ?? me.email} style={{ flex: 1 }} />
            <button>Holding próba</button>
          </form>
          <form action={runNowAction}>
            <ConfirmButton message="Most mindenkinek kiküldi a napi összefoglalót (és a mai reggeli küldés kimarad). Mehet?">Küldés most mindenkinek</ConfirmButton>
          </form>
        </div>
      </div>

      <h2>Előnézet</h2>
      {previewError ? <div className="flash error">Az előnézet nem készült el: {previewError}</div> : (
        <iframe title="Holding e-mail előnézet" srcDoc={preview} style={{ width: "100%", maxWidth: 680, height: 1300, border: "1px solid var(--line)", borderRadius: 12, background: "#eef1f5" }} />
      )}
    </div>
  );
}
