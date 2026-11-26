import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "../auth-actions";
import { setAccessAction, resetMfaAction, logoutEverywhereAction, setMfaRequiredAction, inviteUserAction, resendInviteAction, setOrgAdminAction } from "./actions";
import { mfaRequired } from "@/lib/app-settings";
import { RoleSelect } from "./RoleSelect";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { ENTITY_LABEL } from "@/lib/entity";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const ROLE_HU: Record<string, string> = { owner: "tulajdonos", accountant: "könyvelő", viewer: "CEO - Ügyvezető" };
const dt = (d: Date | null) => (d ? d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  // v6.0.0 – csak a saját ügyfélfiók felhasználói és cégei
  const orgId = me.organizationId;
  const [users, companies, [org]] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.organizationId, orgId)).orderBy(asc(schema.users.name)),
    db.select({ id: schema.companies.id, name: schema.companies.name, entityType: schema.companies.entityType, archivedAt: schema.companies.archivedAt })
      .from(schema.companies).where(eq(schema.companies.organizationId, orgId)).orderBy(asc(schema.companies.name)),
    db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)),
  ]);
  const members = users.length ? await db.select().from(schema.memberships).where(inArray(schema.memberships.userId, users.map((u) => u.id))) : [];
  const required = await mfaRequired(orgId);
  const roleOf = (uid: number, cid: number) => members.find((m) => m.userId === uid && m.companyId === cid)?.role ?? "none";
  const now = new Date();

  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Admin – {org?.name ?? "ügyfélfiók"}</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <form action={logoutAction} className="row">
          <Link href="/admin/log">Tevékenységnapló</Link>
          {me.isPlatformAdmin && <Link href="/admin/platform">Ügyfélfiókok</Link>}
          {me.isPlatformAdmin && <Link href="/admin/summary">Napi összefoglaló</Link>}
          {me.isPlatformAdmin && <Link href="/admin/catalog">Típuskatalógus</Link>}
          <Link href="/">← Cégeim</Link>
          <span className="muted">{me.name}</span>
          <button>Kilépés</button>
        </form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="card fc-head" style={{ marginTop: 6 }}>
        <div>
          <strong>Kétlépcsős azonosítás:</strong>{" "}
          {required ? <span className="badge posted">kötelező mindenkinek</span> : <span className="badge draft">kikapcsolva – elég a jelszó</span>}
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {required
              ? "Kikapcsolva a belépéshez csak a jelszó kell. A már beállított hitelesítő alkalmazások megmaradnak, visszakapcsoláskor nem kell újra beállítani."
              : "Bekapcsoláskor mindenkinek kötelező lesz; aki csak jelszóval van bent, annak újra be kell lépnie (és ha még nincs 2FA-ja, beállítania)."}
          </div>
        </div>
        <form action={setMfaRequiredAction}>
          <input type="hidden" name="on" value={required ? "0" : "1"} />
          {required
            ? <ConfirmButton message="Biztosan kikapcsolod a kétlépcsős azonosítást az ügyfélfiók összes felhasználójára? Ezután a belépéshez elég lesz a jelszó.">2FA kikapcsolása</ConfirmButton>
            : <ConfirmButton className="primary" message="Bekapcsolod a kötelező kétlépcsős azonosítást? Aki csak jelszóval van bent, annak újra be kell lépnie.">2FA bekapcsolása</ConfirmButton>}
        </form>
      </div>

      <h2>Ki mihez fér hozzá</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Sorok: felhasználók, oszlopok: cégek / egységek. A cellában választva azonnal ment.
        {" "}<strong>Tulajdonos</strong>: minden, felhasználókat is adhat hozzá a céghez · <strong>Könyvelő</strong>: rögzíthet és módosíthat ·{" "}
        <strong>CEO - Ügyvezető</strong>: mindent lát, semmit nem módosíthat (csak olvasás).
      </p>
      <div className="table-wrap">
        <table className="access-matrix">
          <thead>
            <tr>
              <th>Felhasználó</th>
              {companies.map((c) => (
                <th key={c.id} className="co">
                  <Link href={`/c/${c.id}`}>{c.name}</Link>{c.archivedAt && <span className="badge draft" style={{ marginLeft: 4 }}>archivált</span>}
                  <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{ENTITY_LABEL[c.entityType]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>{u.isAdmin && <span className="badge reserved" style={{ marginLeft: 6 }}>admin</span>}
                  {!u.lastLoginAt && <span className="badge draft" style={{ marginLeft: 6 }}>meghívva</span>}
                  <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                </td>
                {companies.map((c) => (
                  <td key={c.id}>
                    <form action={setAccessAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="companyId" value={c.id} />
                      <RoleSelect value={roleOf(u.id, c.id)} label={`${u.name} – ${c.name}`} />
                    </form>
                  </td>
                ))}
              </tr>
            ))}
            {companies.length === 0 && <tr><td className="muted">Még nincs cég.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Új felhasználó meghívása</h2>
      <form action={inviteUserAction} className="card form-grid">
        <label>Név<input name="name" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <label className="check"><input type="checkbox" name="isAdmin" /> Admin (felhasználókat és hozzáféréseket kezelhet)</label>
        <div style={{ alignSelf: "end" }}><button className="primary">Meghívó küldése</button></div>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>
        A meghívott e-mailben kap egy 7 napig érvényes linket, amellyel maga állítja be a jelszavát (ha a levélküldés nincs beállítva, a linket itt kapod meg továbbadásra).
        Utána a fenti táblázatban adhatsz neki hozzáférést a cégekhez. {required && "Első belépéskor köteles beállítani a kétlépcsős azonosítást."}
      </p>

      <h2>Felhasználók és kétlépcsős azonosítás</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Felhasználó</th><th>Hozzáférések</th><th>2FA</th><th className="num">Tartalékkód</th><th>Utolsó belépés</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const mine = members.filter((m) => m.userId === u.id);
              const locked = u.mfaLockedUntil && u.mfaLockedUntil > now;
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>{u.id === me.id && <span className="muted"> (te)</span>}
                    <div className="muted" style={{ fontSize: 12 }}>{u.email} · létrehozva {dt(u.createdAt)}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {mine.length ? mine.map((m) => {
                      const c = companies.find((x) => x.id === m.companyId);
                      return <div key={m.companyId}>{c?.name ?? `#${m.companyId}`}: <strong>{ROLE_HU[m.role]}</strong></div>;
                    }) : <span className="muted">nincs hozzáférése</span>}
                  </td>
                  <td>
                    {u.totpEnabledAt
                      ? <span className="badge posted">bekapcsolva</span>
                      : <span className="badge draft">beállításra vár</span>}
                    {u.totpEnabledAt && <div className="muted" style={{ fontSize: 12 }}>{dt(u.totpEnabledAt)} óta</div>}
                    {locked && <div><span className="badge overdue">zárolva {dt(u.mfaLockedUntil)}-ig</span></div>}
                  </td>
                  <td className="num">{u.totpEnabledAt ? `${u.recoveryCodes.length}/10` : "–"}</td>
                  <td>{dt(u.lastLoginAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {u.totpEnabledAt && (
                        <form action={resetMfaAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <ConfirmButton message={`${u.name}: visszaállítod a kétlépcsős azonosítást? Minden eszközről kilép, és a következő belépéskor új QR-kóddal újra be kell állítania.`}>2FA visszaállítása</ConfirmButton>
                        </form>
                      )}
                      <form action={logoutEverywhereAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <ConfirmButton className="link" message={`${u.name}: kiléptetsz minden eszközről?`}>kiléptetés</ConfirmButton>
                      </form>
                      {!u.lastLoginAt && (
                        <form action={resendInviteAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="link">új meghívó</button>
                        </form>
                      )}
                      {u.id !== me.id && (
                        <form action={setOrgAdminAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="on" value={u.isAdmin ? "0" : "1"} />
                          <ConfirmButton className="link" message={u.isAdmin ? `${u.name}: elveszed az admin jogát?` : `${u.name}: adminná teszed? Felhasználókat és hozzáféréseket kezelhet.`}>{u.isAdmin ? "admin jog el" : "admin jog"}</ConfirmButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Elveszett vagy lecserélt telefon: „2FA visszaállítása”, és a felhasználó a következő belépéskor új QR-kódot kap.
        5 hibás kód után a fiók 15 percre zárolódik; a „kiléptetés” a zárolást is feloldja.
        Hibás jelszónál: fiókonként 5 próbálkozás után 15, IP-címenként 30 után 30 perc szünet. Elfelejtett jelszót a belépő oldalon lehet visszaállítani.
      </p>

      <AppFooter version={APP_VERSION} />
    </div>
  );
}
