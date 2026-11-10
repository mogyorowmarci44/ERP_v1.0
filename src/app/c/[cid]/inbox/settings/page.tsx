import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireCompany } from "@/lib/auth";
import { getInboxSettings } from "@/lib/inbox/service";
import { extractionAvailable, EXTRACT_MODEL } from "@/lib/inbox/extract";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { saveSettingsAction, newSecretAction, testConnectionAction } from "../actions";

function scriptSource() {
  try { return readFileSync(path.join(process.cwd(), "tools/apps-script/mm-erp-inbox.gs"), "utf8"); } catch { return "// A szkript a repóban: tools/apps-script/mm-erp-inbox.gs"; }
}

export default async function InboxSettingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const { settings: s } = await getInboxSettings(cid);
  const newSecret = sp.secret;
  const code = scriptSource().replace("IDE_JON_AZ_ERP_KULCS", newSecret ?? "IDE_JON_AZ_ERP_KULCS");
  const driveLink = (id?: string | null) => (id ? `https://drive.google.com/drive/folders/${id}` : "");

  return (
    <>
      <div className="topbar">
        <h1>Beérkező bizonylatok – beállítások</h1>
        <Link className="btn" href={`/c/${cid}/inbox`}>← Vissza</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="card" style={{ marginBottom: 14 }}>
        <strong>Kiolvasás:</strong> ingyenes, AI nélkül – a PDF-számlák szövegéből, a bankkivonat CSV / Excel exportjából, a szkennelt és fotózott bizonylatoknál a Google Drive szövegfelismerésével (ehhez kell a lenti Google-kapcsolat).
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Opcionális AI-kiegészítés (az ismeretlen formátumú bizonylatokhoz):{" "}
          {extractionAvailable() ? <span className="pos">bekapcsolva ({EXTRACT_MODEL})</span> : <>kikapcsolva – ha egyszer szeretnéd, a Renderen add hozzá az <code>ANTHROPIC_API_KEY</code> változót. Nélküle az ismeretlen formátumok jóváhagyásra kerülnek.</>}
        </p>
      </div>

      {newSecret && (
        <div className="card check-panel ok" style={{ marginBottom: 14 }}>
          <strong>Új kulcs:</strong> <code style={{ userSelect: "all" }}>{newSecret}</code>
          <p className="muted" style={{ margin: "6px 0 0" }}>Ez csak most látszik. Az alábbi szkriptben már benne van – másold be a Google Apps Script-be, és telepítsd újra (Telepítés → Telepítések kezelése → szerkesztés → Új verzió).</p>
        </div>
      )}

      <form action={saveSettingsAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label style={{ gridColumn: "1 / -1" }}>Google Apps Script web app címe (…/exec)
          <input name="scriptUrl" defaultValue={s.scriptUrl ?? ""} placeholder="https://script.google.com/macros/s/…/exec" disabled={!canWrite} />
        </label>
        <label>Kulcs {s.secretEnc ? <small className="muted">(beállítva – üresen hagyva nem változik)</small> : <small className="neg">(nincs)</small>}
          <input name="secret" type="password" autoComplete="off" placeholder={s.secretEnc ? "••••••••" : "generálj egyet lent"} disabled={!canWrite} />
        </label>
        <label style={{ gridColumn: "span 2" }}>Gmail keresés (melyik leveleket nézze)
          <input name="gmailQuery" defaultValue={s.gmailQuery ?? ""} placeholder="has:attachment (számla OR szamla OR invoice OR rechnung OR díjbekérő OR storno) -in:sent" disabled={!canWrite} />
        </label>
        <label>Drive: Bejövő számlák mappa (link vagy ID)
          <input name="invoiceFolder" defaultValue={driveLink(s.invoiceFolderId)} disabled={!canWrite} />
        </label>
        <label>Drive: Bankkivonatok mappa (link vagy ID)
          <input name="statementFolder" defaultValue={driveLink(s.statementFolderId)} disabled={!canWrite} />
        </label>
        <label>Csak ettől a naptól
          <input type="date" name="since" defaultValue={s.since ?? ""} disabled={!canWrite} />
        </label>
        <label className="check"><input type="checkbox" name="autoPost" defaultChecked={s.autoPost !== false} disabled={!canWrite} /> az egyértelmű bizonylatokat magától könyvelje</label>
        {canWrite && <div style={{ alignSelf: "end" }}><button className="primary">Mentés</button></div>}
      </form>

      {canWrite && (
        <div className="row" style={{ margin: "12px 0" }}>
          <form action={newSecretAction}><input type="hidden" name="cid" value={cid} /><button>Új kulcs generálása</button></form>
          <form action={testConnectionAction}><input type="hidden" name="cid" value={cid} /><SubmitButton pendingText="Kapcsolódás…">Kapcsolat tesztelése</SubmitButton></form>
        </div>
      )}

      <h2>Telepítés a Google-fiókba (egyszer, cégenként)</h2>
      <ol className="setup-steps">
        <li>Jelentkezz be abba a Google-fiókba, ahová a számlák érkeznek (pl. mmcartradekft@gmail.com), és nyisd meg: <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com → Új projekt</a>.</li>
        <li>Kattints fent a <strong>Új kulcs generálása</strong> gombra – utána az alábbi kód már a kulccsal együtt jelenik meg.</li>
        <li>Töröld ki a szerkesztőben lévő mintakódot, és másold be az alábbi teljes kódot. Mentés (💾), a projekt neve lehet „MM ERP bizonylatok”.</li>
        <li>A szerkesztő bal oldalán <strong>Szolgáltatások (+) → Drive API → Hozzáadás</strong> – ez kell a szkennelt / fotózott számlák ingyenes szövegfelismeréséhez.</li>
        <li><strong>Telepítés → Új telepítés</strong> → fogaskerék: <em>Webes alkalmazás</em> → Végrehajtás mint: <em>Én</em> → Hozzáférés: <em>Bárki</em> → Telepítés. Engedélyezd a Gmail és Drive olvasását (a „nem ellenőrzött alkalmazás” figyelmeztetésnél: Speciális → Ugrás a projektre).</li>
        <li>A kapott <code>…/exec</code> webcímet másold be fent, add meg a két Drive-mappa linkjét, Mentés, majd <strong>Kapcsolat tesztelése</strong>.</li>
      </ol>
      <p className="muted">A szkript csak olvas, és csak akkor fut, amikor a „Beolvasás és könyvelés” gombot megnyomod. A kulcs nélkül senki nem tudja használni.</p>
      <details className="fc-more" open={!!newSecret}>
        <summary>A szkript kódja</summary>
        <pre className="code-block">{code}</pre>
      </details>
    </>
  );
}
