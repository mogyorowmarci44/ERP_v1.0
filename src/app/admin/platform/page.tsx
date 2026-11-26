import Link from "next/link";
import { and, asc, count, desc, eq, gt, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { createOrganizationAction, grantSupportAccessAction } from "../actions";
import { actionLabel } from "@/lib/audit-calc";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const dt = (d: Date | null) => (d ? d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

/**
 * v6.0.0 – Üzemeltető: ügyfélfiókok áttekintése (csak darabszámok, könyvelési adat nélkül), új ügyfélfiók,
 * és időkorlátos, indokolt, naplózott támogatói hozzáférés egy ügyfél cégéhez.
 */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requirePlatformAdmin();
  const sp = await searchParams;
  const { organizations, users, companies, supportGrants, auditLog } = schema;
  const [orgs, userCounts, companyRows, grants, supportLog] = await Promise.all([
    db.select().from(organizations).orderBy(asc(organizations.name)),
    db.select({ org: users.organizationId, n: count(), last: max(users.lastLoginAt) }).from(users).groupBy(users.organizationId),
    db.select({ id: companies.id, name: companies.name, org: companies.organizationId, archivedAt: companies.archivedAt }).from(companies).orderBy(asc(companies.name)),
    db.select({ companyId: supportGrants.companyId, expiresAt: supportGrants.expiresAt }).from(supportGrants)
      .where(and(eq(supportGrants.userId, me.id), gt(supportGrants.expiresAt, new Date()))),
    db.select().from(auditLog).where(eq(auditLog.action, "support.grant")).orderBy(desc(auditLog.id)).limit(20),
  ]);
  const uc = new Map(userCounts.map((r) => [r.org, r]));
  const active = new Map(grants.map((g) => [g.companyId, g.expiresAt]));
  const coName = new Map(companyRows.map((c) => [c.id, c.name]));

  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Üzemeltetés – ügyfélfiókok</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link><Link href="/">Cégeim</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted" style={{ marginTop: -4 }}>
        Az ügyfélfiókok egymás adatait nem látják. Itt csak a fiókok és cégek neve, darabszáma látszik; egy ügyfél cégébe csak
        <strong> támogatói hozzáféréssel</strong> lehet belenézni: indoklással, 2 óráig, csak olvasásra – és ez az ügyfél saját tevékenységnaplójában is megjelenik.
      </p>

      <h2>Ügyfélfiókok</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ügyfélfiók</th><th className="num">Felhasználó</th><th>Utolsó belépés</th><th>Cégek</th><th>2FA</th><th>Létrehozva</th></tr></thead>
          <tbody>
            {orgs.map((o) => {
              const cs = companyRows.filter((c) => c.org === o.id);
              return (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{o.id === me.organizationId && <span className="muted"> (saját)</span>}</td>
                  <td className="num">{uc.get(o.id)?.n ?? 0}</td>
                  <td>{dt(uc.get(o.id)?.last ?? null)}</td>
                  <td style={{ fontSize: 13 }}>
                    {cs.length === 0 && <span className="muted">nincs cég</span>}
                    {cs.map((c) => (
                      <div key={c.id} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <span>{c.name}{c.archivedAt && <span className="badge draft" style={{ marginLeft: 4 }}>archivált</span>}</span>
                        {o.id !== me.organizationId && (active.has(c.id)
                          ? <Link href={`/c/${c.id}`}>megnyitás (eddig: {dt(active.get(c.id)!)})</Link>
                          : (
                            <form action={grantSupportAccessAction} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                              <input type="hidden" name="companyId" value={c.id} />
                              <input name="reason" placeholder="indoklás (pl. hibabejelentés)" required minLength={5} style={{ width: 200 }} />
                              <button className="link">támogatói hozzáférés</button>
                            </form>
                          ))}
                      </div>
                    ))}
                  </td>
                  <td>{o.mfaRequired ? <span className="badge posted">kötelező</span> : <span className="badge draft">nem kötelező</span>}</td>
                  <td>{dt(o.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Új ügyfélfiók</h2>
      <form action={createOrganizationAction} className="card form-grid">
        <label>Ügyfélfiók neve<input name="orgName" required placeholder="pl. Minta Kft. / Minta Könyvelőiroda" /></label>
        <label>Admin neve<input name="adminName" required /></label>
        <label>Admin e-mail címe<input name="email" type="email" required /></label>
        <div style={{ alignSelf: "end" }}><button className="primary">Létrehozás és meghívó</button></div>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Az admin meghívó linket kap (7 nap), azzal állítja be a jelszavát; utána ő hozza létre a cégeit és hívja meg a kollégáit.</p>

      <h2>Támogatói hozzáférések (utolsó 20)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Időpont</th><th>Ki</th><th>Cég</th><th>Indoklás</th></tr></thead>
          <tbody>
            {supportLog.map((r) => (
              <tr key={r.id}>
                <td>{dt(r.at)}</td>
                <td>{r.userEmail}</td>
                <td>{r.companyId ? coName.get(r.companyId) ?? `#${r.companyId}` : "–"}</td>
                <td>{String((r.details as { reason?: string } | null)?.reason ?? "")} <span className="muted">· {actionLabel(r.action)}</span></td>
              </tr>
            ))}
            {supportLog.length === 0 && <tr><td colSpan={4} className="muted">Még nem volt támogatói hozzáférés.</td></tr>}
          </tbody>
        </table>
      </div>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
