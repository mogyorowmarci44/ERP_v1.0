import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { deletionBlockers } from "@/lib/privacy";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { deleteMyAccountAction, closeOrganizationAction } from "@/app/auth-actions";

export const metadata = { title: "Fiókom és adataim – mogyorosi.erp" };

/** v7.6.0 – Önkiszolgáló adatkérés és -törlés (GDPR). */
export default async function MyAccountPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const blockers = await deletionBlockers(user.id);
  const orgCompanies = user.isAdmin && user.organizationId
    ? Number((await db.select({ n: count() }).from(schema.companies).where(eq(schema.companies.organizationId, user.organizationId)))[0].n)
    : null;
  return (
    <div className="main" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}><ErpLogo size={28} /><h1>Fiókom és adataim</h1></div>
        <Link className="btn" href="/">← Cégeim</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <section className="card help-section">
        <h2>Saját adataim letöltése</h2>
        <p>A fiókod adatai (név, e-mail, belépési és 2FA-állapot, cégeid és szereped, a tevékenységnaplód) géppel olvasható JSON-fájlban.</p>
        <p className="muted">A cégek könyvelési adatai (számlák, napló, partnerek…) a cég adatai – azokat a cég teljes mentése tartalmazza (Admin › Mentés, vagy a tulajdonosnak a Cégeim oldalon).</p>
        <a className="btn primary" href="/fiokom/adataim">Adataim letöltése (JSON)</a>
      </section>

      <section className="card help-section">
        <h2>Fiókom törlése</h2>
        <p>
          A törlés végleges: a neved, az e-mail címed, a jelszavad és a kétlépcsős azonosításod törlődik, és minden eszközön kijelentkezel. A könyvelési tételek – amelyeket a számviteli
          törvény szerint meg kell őrizni – a cégnél maradnak, de „Törölt felhasználó” szerepel náluk.
        </p>
        {blockers.length ? (
          <div className="flash error" role="status"><strong>Most még nem törölhető:</strong><ul style={{ margin: "6px 0 0" }}>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
        ) : (
          <form action={deleteMyAccountAction} className="form-grid">
            <label>Jelszó<input type="password" name="password" required autoComplete="current-password" /></label>
            <label>Megerősítés: írd be, hogy <strong>TÖRLÖM</strong><input name="confirm" required autoComplete="off" /></label>
            <div style={{ alignSelf: "end" }}><ConfirmButton className="danger" message="Biztosan véglegesen törlöd a fiókodat?">Fiókom végleges törlése</ConfirmButton></div>
          </form>
        )}
      </section>

      {orgCompanies !== null && (
        <section className="card help-section">
          <h2>Ügyfélfiók megszüntetése</h2>
          <p>Az előfizetés lemondása és az ügyfélfiók minden felhasználójának álnevesítése. Csak akkor lehetséges, ha már nincs benne cég.</p>
          {orgCompanies > 0 ? (
            <p className="muted">
              Az ügyfélfiókban még {orgCompanies} cég van. Előbb töltsd le a teljes mentésüket (Admin › Mentés), majd a Cégeim oldalon archiváld őket; a végleges törlés az archiválás után 30 nappal kérhető.
            </p>
          ) : (
            <form action={closeOrganizationAction} className="form-grid">
              <label>Jelszó<input type="password" name="password" required autoComplete="current-password" /></label>
              <label>Megerősítés: írd be, hogy <strong>MEGSZÜNTETEM</strong><input name="confirm" required autoComplete="off" /></label>
              <div style={{ alignSelf: "end" }}><ConfirmButton className="danger" message="Biztosan megszünteted az ügyfélfiókot? Minden felhasználója törlődik.">Ügyfélfiók megszüntetése</ConfirmButton></div>
            </form>
          )}
        </section>
      )}
      <p className="muted">Kérdés esetén: <Link href="/jogi/adatkezeles">adatkezelési tájékoztató</Link>.</p>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
