import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireCompany } from "@/lib/auth";
import { getInboxSettings } from "@/lib/inbox/service";
import { extractionAvailable, EXTRACT_MODEL } from "@/lib/inbox/extract";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { saveSettingsAction, newSecretAction, testConnectionAction, connectBankAction, bankSyncNowAction, saveBankAction, disconnectBankAction, saveInvoicingAction, removeInvoicingAction, invoicingSyncNowAction } from "../actions";
import type { InvoicingLink } from "@/db/schema";
import { ebConfigured } from "@/lib/bank/enable-banking";
import { consentWarning } from "@/lib/bank/sync";
import { today } from "@/lib/dates";

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
        <p className="muted" style={{ margin: "6px 0 0" }}>
          <strong>Papír számlák:</strong> a Google Drive app <em>Szkennelés</em> funkciójával (vagy Microsoft Lensszel) fotózd le, és mentsd a Bejövő számlák mappába – vagy töltsd fel a Beérkező bizonylatok oldalon.
          A rendszer iktatószámot ad (P-ÉÉÉÉ-0001), és rányomtatja a digitális példányra a lefűzőbeli hellyel együtt – a papírra nem kell ráírni semmit, csak fűzd le havonta a beszkennelés sorrendjében. Lekönyvelés előtt ellenőrzi az adószám ellenőrző számjegyét, az ÁFA-t (nettó × kulcs), a dátumokat és a lezárt időszakokat; ami nem stimmel, jóváhagyásra kerül.
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

      <h2 id="bank">Bank – automatikus napi letöltés</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Minden reggel letölti az előző napig könyvelt banki tételeket, és kivonatként a Beérkező bizonylatok közé teszi: a rendszer párosítja őket a nyitott számlákkal,
          az egyértelműeket lekönyveli, a többi jóváhagyásra vár. A már könyvelt pénzmozgásokat kihagyja. A kapcsolat az Enable Banking engedélyes számlainformációs
          szolgáltatón keresztül megy (az Erste API-ja közvetlenül csak engedélyes szolgáltatónak érhető el); a hozzájárulás legfeljebb 180 napig él, utána a bank appjában újra jóvá kell hagyni.
        </p>
        {!ebConfigured() ? (
          <p className="neg" style={{ marginBottom: 0 }}>A szerveren nincs beállítva: add hozzá a Renderen az <code>EB_APP_ID</code>, <code>EB_PRIVATE_KEY</code> és <code>APP_URL</code> változót (lépések a README „v3.10.0” részében).</p>
        ) : s.bank ? (
          <>
            <p style={{ margin: "0 0 6px" }}>
              <strong>{s.bank.aspsp.name}</strong> ({s.bank.psuType === "business" ? "céges" : "lakossági"}) · összekapcsolva {s.bank.connectedAt.slice(0, 10)} ·
              hozzájárulás érvényes: <strong>{s.bank.validUntil?.slice(0, 10) ?? "?"}</strong>
              {s.bank.lastRunAt && <> · utolsó letöltés: {s.bank.lastRunAt.slice(0, 16).replace("T", " ")} – {s.bank.lastResult}</>}
            </p>
            {(s.bank.lastError || consentWarning(s.bank)) && <p className="neg" style={{ margin: "0 0 6px" }}>{s.bank.lastError || consentWarning(s.bank)}</p>}
            <form action={saveBankAction} className="form-grid">
              <input type="hidden" name="cid" value={cid} />
              <div style={{ gridColumn: "1 / -1" }}>
                {s.bank.accounts.map((a) => (
                  <label key={a.uid} className="check"><input type="checkbox" name="acc" value={a.uid} defaultChecked={a.enabled} disabled={!canWrite} /> {a.iban ?? a.uid} · {a.currency}{a.name ? ` · ${a.name}` : ""} → {a.currency === "EUR" ? "3841" : "384"}</label>
                ))}
              </div>
              <label>Ettől a naptól töltse le
                <input type="date" name="bankSince" defaultValue={s.bank.since} disabled={!canWrite} />
              </label>
              {canWrite && <div style={{ alignSelf: "end" }}><button>Mentés</button></div>}
            </form>
            {canWrite && (
              <div className="row" style={{ marginTop: 10 }}>
                <form action={bankSyncNowAction}><input type="hidden" name="cid" value={cid} /><SubmitButton pendingText="Letöltés…">Letöltés most</SubmitButton></form>
                <form action={connectBankAction}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="aspsp" value={s.bank.aspsp.name} /><input type="hidden" name="country" value={s.bank.aspsp.country} />
                  <input type="hidden" name="psuType" value={s.bank.psuType} /><input type="hidden" name="bankSince" value={s.bank.since} />
                  <button>Hozzájárulás megújítása</button>
                </form>
                <form action={disconnectBankAction}><input type="hidden" name="cid" value={cid} /><button className="danger">Leválasztás</button></form>
              </div>
            )}
          </>
        ) : canWrite ? (
          <form action={connectBankAction} className="form-grid">
            <input type="hidden" name="cid" value={cid} />
            <label>Bank neve<input name="aspsp" defaultValue="Erste" /></label>
            <label>Ország<input name="country" defaultValue="HU" maxLength={2} /></label>
            <label>Számla típusa
              <select name="psuType" defaultValue="business"><option value="business">céges</option><option value="personal">lakossági</option></select>
            </label>
            <label>Ettől a naptól töltse le<input type="date" name="bankSince" defaultValue={today()} /></label>
            <div style={{ alignSelf: "end" }}><button className="primary">Összekapcsolás a bankkal →</button></div>
          </form>
        ) : <p className="muted">Nincs banki kapcsolat.</p>}
      </div>

      <h2 id="szamlazo">Számlázóprogram – kiállított számlák automatikusan</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          A számlázz.hu-ban vagy a Billingóban kiállított számlák a „Beolvasás és könyvelés” gombra (vagy itt a „Letöltés most”-ra) maguktól bejönnek a Beérkező bizonylatok közé,
          a PDF-fel és a pontos tételadatokkal együtt – szövegfelismerés nélkül. Az egyértelműeket a rendszer lekönyveli (vevő, ÁFA-kód, árbevétel-számla a korábbi könyvelések alapján), a többi jóváhagyásra vár.
        </p>
        {(["szamlazz", "billingo"] as const).map((p) => {
          const l: InvoicingLink | undefined = (s.invoicing ?? []).find((x) => x.provider === p);
          return (
            <div key={p} style={{ borderTop: "1px solid var(--border, #ddd)", paddingTop: 10, marginTop: 10 }}>
              <strong>{p === "szamlazz" ? "számlázz.hu" : "Billingo"}</strong>{" "}
              {l ? <span className="pos">összekapcsolva</span> : <span className="muted">nincs összekapcsolva</span>}
              {l && (
                <p className="muted" style={{ margin: "4px 0" }}>
                  {p === "szamlazz" ? <>következő lekérdezett sorszám: <strong>{l.prefix}{l.nextSeq}</strong></> : <>kiállítás dátuma ettől: <strong>{l.since}</strong></>}
                  {l.lastRunAt && <> · utolsó letöltés: {l.lastRunAt.slice(0, 16).replace("T", " ")} – {l.lastResult}</>}
                </p>
              )}
              {l?.lastError && <p className="neg" style={{ margin: "4px 0" }}>{l.lastError}</p>}
              {canWrite && (
                <form action={saveInvoicingAction} className="form-grid" style={{ marginTop: 6 }}>
                  <input type="hidden" name="cid" value={cid} />
                  <input type="hidden" name="provider" value={p} />
                  <label>{p === "szamlazz" ? "Számla Agent kulcs" : "API-kulcs"} {l && <small className="muted">(beállítva – üresen hagyva nem változik)</small>}
                    <input name="key" type="password" autoComplete="off" placeholder={l ? "••••••••" : ""} />
                  </label>
                  {p === "szamlazz" ? (
                    <label>Utolsó kiállított számla sorszáma {l && <small className="muted">(csak ha újra kell kezdeni)</small>}
                      <input name="lastNumber" placeholder="pl. E-MMCT-2026-41" />
                    </label>
                  ) : (
                    <label>Ettől a kiállítási dátumtól
                      <input type="date" name="since" defaultValue={l?.since ?? today()} />
                    </label>
                  )}
                  <div style={{ alignSelf: "end" }}><SubmitButton pendingText="Ellenőrzés…">{l ? "Mentés" : "Összekapcsolás"}</SubmitButton></div>
                </form>
              )}
              {canWrite && l && (
                <form action={removeInvoicingAction} style={{ marginTop: 6 }}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="provider" value={p} />
                  <button className="danger">Leválasztás</button>
                </form>
              )}
            </div>
          );
        })}
        {canWrite && (s.invoicing ?? []).length > 0 && (
          <form action={invoicingSyncNowAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="cid" value={cid} />
            <SubmitButton pendingText="Letöltés…">Letöltés most</SubmitButton>
          </form>
        )}
        <details className="fc-more" style={{ marginTop: 10 }}>
          <summary>Hol találom a kulcsot?</summary>
          <ul>
            <li><strong>számlázz.hu:</strong> Beállítások → Számla Agent kulcsok → Új kulcs. A rendszer az utolsó megadott sorszámtól kezdve egymás után kérdezi le a számlákat (pl. E-MMCT-2026-42, -43 …); ha a számlázz.hu-ban új évben új előtag indul, magától átvált rá.</li>
            <li><strong>Billingo:</strong> Beállítások → API → Új API-kulcs (a Billingo API csak bizonyos csomagokban érhető el). A rendszer a megadott dátumtól tölti le a számlákat, sztornókat és előlegszámlákat; díjbekérőt nem.</li>
          </ul>
          <p className="muted">A kulcs titkosítva tárolódik, és csak olvasásra használjuk – az ERP nem állít ki és nem módosít számlát a számlázóprogramban.</p>
        </details>
      </div>

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
