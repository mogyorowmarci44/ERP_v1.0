/** v2.0 – Áttekintés: adatfrissítés (gomb, szinkronfájl, források állapota és beállítása). */
import type { TaxProfile } from "@/db/schema";
import { lastSyncs } from "@/lib/gh-sync";
import { refreshAllAction, saveSyncSettingsAction, uploadSyncAction } from "./actions";

const fmtAt = (d: string | Date) => new Date(d).toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function RefreshCard({ cid, profile }: { cid: number; profile: TaxProfile }) {
  const logs = await lastSyncs(cid);
  const s = profile.sync ?? {};
  return (
    <section id="frissites" className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>Adatfrissítés</strong>
          <div className="muted" style={{ fontSize: 12.5 }}>Airbnb-naptár (iCal), Meta Ads és Instagram – ami be van állítva. A nevek, összegek és értékelések az Airbnb-fiókból készült szinkronfájllal jönnek.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <form action={uploadSyncAction} className="row" style={{ gap: 6 }}>
            <input type="hidden" name="cid" value={cid} />
            <input type="file" name="file" accept="application/json,.json" required style={{ maxWidth: 230 }} aria-label="Szinkronfájl" />
            <button>Szinkronfájl betöltése</button>
          </form>
          <form action={refreshAllAction}>
            <input type="hidden" name="cid" value={cid} />
            <button className="primary">⟳ Minden adat frissítése</button>
          </form>
        </div>
      </div>
      {logs.length ? (
        <table style={{ marginTop: 10 }}>
          <tbody>
            {logs.map((l) => (
              <tr key={l.source}>
                <td style={{ width: 200 }}>{l.source}</td>
                <td style={{ width: 28 }} className={l.ok ? "pos" : "neg"}>{l.ok ? "✓" : "✗"}</td>
                <td>{l.message}</td>
                <td className="muted num" style={{ width: 150 }}>{fmtAt(l.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer" }} className="muted">Adatforrások beállítása</summary>
        <form action={saveSyncSettingsAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="cid" value={cid} />
          <div className="form-grid">
            <label>Airbnb naptárexport (iCal) címe<input name="airbnbIcalUrl" defaultValue={s.airbnbIcalUrl ?? ""} placeholder="https://www.airbnb.com/calendar/ical/….ics?s=…" /></label>
            <label>Meta hozzáférési token {s.metaToken ? "(mentve – üresen hagyva megmarad)" : ""}<input name="metaToken" type="password" autoComplete="off" placeholder={s.metaToken ? "••••••••" : "ads_read, instagram_basic jogosultsággal"} /></label>
            <label>Meta hirdetési fiók azonosító<input name="metaAdAccount" defaultValue={s.metaAdAccount ?? ""} placeholder="act_1234567890" /></label>
            <label>Instagram-fiók azonosító (IG user ID)<input name="igUserId" defaultValue={s.igUserId ?? ""} placeholder="1784…" /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button>Mentés</button>
            {s.metaToken ? <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="clearToken" /> token törlése</label> : null}
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            iCal: Airbnb → Naptár → Elérhetőség → „Naptárak összekapcsolása” → „Airbnb-naptár exportálása”. A naptárexport a foglalások dátumát és kódját, valamint a kiblokkolt napokat tartalmazza –
            a vendég nevét, a kifizetést, a blokkokhoz írt megjegyzést és az értékeléseket az Airbnb nem adja ki rajta. A Meta token a developers.facebook.com-on létrehozott alkalmazásból kérhető; az adatbázisban tároljuk, a felületen nem jelenik meg.
          </p>
        </form>
      </details>
    </section>
  );
}
