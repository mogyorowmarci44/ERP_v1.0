import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createCompanyAction, createPrivateTaxpayerAction, logoutAction, changePasswordAction, archiveCompanyAction, restoreCompanyAction, purgeCompanyAction, acceptTermsAction } from "./auth-actions";
import { TERMS_VERSION } from "@/lib/vendor";
import { canPurge, daysUntilPurge, exportFresh, PURGE_GRACE_DAYS, EXPORT_MAX_AGE_HOURS } from "@/lib/archive-calc";
import { TaxProfileFields } from "@/components/TaxProfileFields";
import { ENTITY_LABEL } from "@/lib/entity";
import { ACTIVITY_LABEL, ACTIVITY_PROFILES, ACTIVITY_SHORT } from "@/lib/activity";
import { APP_VERSION } from "@/lib/version";
import { Flash } from "@/components/Flash";
import { CompanyMark, ErpLogo, AppFooter } from "@/components/Brand";
import { normalizeTheme } from "@/lib/themes";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const list = await db
    .select({
      c: {
        id: schema.companies.id,
        name: schema.companies.name,
        taxNumber: schema.companies.taxNumber,
        vatPeriod: schema.companies.vatPeriod,
        entityType: schema.companies.entityType,
        activityProfile: schema.companies.activityProfile,
        theme: schema.companies.theme,
        logoUpdatedAt: schema.companies.logoUpdatedAt,
        archivedAt: schema.companies.archivedAt,
        lastFullExportAt: schema.companies.lastFullExportAt,
      },
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(schema.companies.name);
  // v6.0.0 – archivált cégek külön, a lista alján
  const all = list;
  const activeList = all.filter((x) => !x.c.archivedAt);
  const archivedList = all.filter((x) => x.c.archivedAt);
  const now = new Date();
  const dt = (d: Date) => d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="main" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Cégeim</h1>
          <span className="version-tag">v{APP_VERSION}</span>
          {/* v4.1.0 – ERP-térkép: a modulok és kapcsolataik, cégválasztás előtt is */}
          <a className="btn" href="/terkep">ERP-térkép</a>
        </div>
        <form action={logoutAction} className="row">
          {user.isAdmin && <Link href="/admin">Admin – hozzáférések</Link>}
          {user.isPlatformAdmin && <Link href="/admin/platform">Ügyfélfiókok</Link>}
          <span className="muted">{user.name}</span>
          <button>Kilépés</button>
        </form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {user.termsVersion !== TERMS_VERSION && (
        <form action={acceptTermsAction} className="card" style={{ borderLeft: "4px solid var(--accent, #1f3a5f)" }}>
          <strong>{user.termsVersion ? "Frissültek a felhasználási feltételek." : "Kérjük, fogadd el a felhasználási feltételeket."}</strong>
          <div className="row" style={{ gap: 12, marginTop: 8 }}>
            <label className="check"><input type="checkbox" name="terms" required /> Elfogadom az <a href="/jogi/aszf" target="_blank">ÁSZF</a>-et (és az <a href="/jogi/adatfeldolgozas" target="_blank">adatfeldolgozói szerződést</a>), és megismertem az <a href="/jogi/adatkezeles" target="_blank">adatkezelési tájékoztatót</a>.</label>
            <button className="primary">Elfogadom</button>
          </div>
        </form>
      )}
      {activeList.length === 0 && <p className="muted">Még nincs cég. Hozd létre az elsőt lent – a számlatükör, ÁFA-kódok és naplók automatikusan betöltődnek.</p>}
      <div className="company-grid">
        {activeList.map(({ c, role }) => {
          const t = normalizeTheme(c.theme);
          return (
            <Link key={c.id} href={`/c/${c.id}`} className="card company-card">
              <div className="band" style={{ background: t.sidebar }}>
                <CompanyMark id={c.id} name={c.name} logoVersion={c.logoUpdatedAt ? c.logoUpdatedAt.getTime() : null} />
              </div>
              <div className="body">
                <strong>{c.name}</strong>
                <span className="entity-tag">{ENTITY_LABEL[c.entityType]}{c.entityType === "company" ? ` · ${ACTIVITY_SHORT[c.activityProfile]}` : ""}</span>
                <span className="muted">{c.taxNumber ?? "adószám nélkül"}</span>
                <span className="muted">ÁFA: {{ monthly: "havi", quarterly: "negyedéves", yearly: "éves" }[c.vatPeriod]} bevalló, szerep: {{ owner: "tulajdonos", accountant: "könyvelő", viewer: "CEO - Ügyvezető" }[role]}</span>
              </div>
              <div style={{ height: 4, background: t.accent }} />
            </Link>
          );
        })}
      </div>

      <h2>Új cég (Bt / Kft / Zrt)</h2>
      <form action={createCompanyAction} className="card form-grid">
        <label>Sablon
          <select name="activityProfile" defaultValue="general">
            {ACTIVITY_PROFILES.map((p) => <option key={p} value={p}>{ACTIVITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label>Cégnév<input name="name" required placeholder="Új Kft" /></label>
        <label>Adószám<input name="taxNumber" placeholder="12345678-2-42" /></label>
        <label>Közösségi adószám<input name="euVatNumber" placeholder="HU12345678" /></label>
        <label>Cégjegyzékszám<input name="registrationNumber" /></label>
        <label>Székhely<input name="address" /></label>
        <label>ÁFA bevallási időszak
          <select name="vatPeriod" defaultValue="monthly">
            <option value="monthly">havi</option><option value="quarterly">negyedéves</option><option value="yearly">éves</option>
          </select>
        </label>
        <div style={{ alignSelf: "end" }}><button className="primary">Cég létrehozása</button></div>
      </form>
      <p className="muted">Új cég létrehozásakor betöltődik az alap számlatükör, ÁFA-kódok (köztük a különbözeti) és naplók – mindkét sablonnál ugyanaz, üres adatokkal. A sablon (tevékenységprofil) később a Beállításokban módosítható.</p>

      <h2>Új adószámos magánszemély (pl. vendégház)</h2>
      <form action={createPrivateTaxpayerAction} className="card form-grid">
        <label>Megnevezés<input name="name" required placeholder="pl. Vendégház – <település>" /></label>
        <label>Adószám<input name="taxNumber" placeholder="12345678-1-02" /></label>
        <label>Közösségi adószám<input name="euVatNumber" placeholder="HU12345678 (Airbnb / Booking jutalékhoz)" /></label>
        <label>Szálláshely címe<input name="address" /></label>
        <label>ÁFA bevallási időszak (fordított ÁFA)
          <select name="vatPeriod" defaultValue="quarterly">
            <option value="monthly">havi</option><option value="quarterly">negyedéves</option><option value="yearly">éves</option>
          </select>
        </label>
        <TaxProfileFields />
        <div style={{ alignSelf: "end" }}><button className="primary">Magánszemély felvétele</button></div>
      </form>
      <p className="muted">Egyszerű, szálláshely-szolgáltatásra szabott számlatükör (szállásdíj csatornánként, rezsi, platform jutalék, magánszféra), alanyi mentes ÁFA-kódok és SZJA / tételes adó modul töltődik be. Mérleg és tagi kölcsön itt nincs.</p>

      <h2>Jelszócsere</h2>
      <form action={changePasswordAction} className="card form-grid">
        <label>Jelenlegi jelszó<input name="current" type="password" required /></label>
        <label>Új jelszó<input name="password" type="password" minLength={10} required /></label>
        <div style={{ alignSelf: "end" }}><button>Módosítás</button></div>
      </form>

      {all.some((x) => x.role === "owner") && (
        <>
          <h2>Cég archiválása</h2>
          {activeList.some((x) => x.role === "owner") ? (
            <>
              <p className="muted" style={{ marginTop: -4 }}>
                Archiválás előtt töltsd le a cég <strong>teljes mentését</strong> (minden adat, a beszkennelt bizonylatokkal és a bérszámfejtéssel együtt – később vissza is állítható). Archiválás után a cég csak olvasható, kikerül a listákból és a
                napi összefoglalóból, és bármikor visszaállítható. Végleges törlés csak {PURGE_GRACE_DAYS} nap után kérhető.
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Cég</th><th>Teljes mentés</th><th>Archiválás</th></tr></thead>
                  <tbody>
                    {activeList.filter((x) => x.role === "owner").map(({ c }) => {
                      const fresh = exportFresh(c.lastFullExportAt, now);
                      return (
                        <tr key={c.id}>
                          <td><strong>{c.name}</strong><div className="muted" style={{ fontSize: 12 }}>{ENTITY_LABEL[c.entityType]}</div></td>
                          <td>
                            <a className="btn" href={`/c/${c.id}/backup`}>Teljes mentés letöltése</a>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {c.lastFullExportAt ? `utoljára: ${dt(c.lastFullExportAt)}` : "még nem volt"}{!fresh && c.lastFullExportAt ? ` – ${EXPORT_MAX_AGE_HOURS} óránál régebbi` : ""}
                            </div>
                          </td>
                          <td>
                            <form action={archiveCompanyAction} className="row" style={{ gap: 6 }}>
                              <input type="hidden" name="companyId" value={c.id} />
                              <input name="password" type="password" autoComplete="current-password" placeholder="jelszavad" required disabled={!fresh} />
                              <button className="danger" disabled={!fresh} title={fresh ? "" : "Előbb töltsd le a teljes mentést"}>Archiválás</button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="muted">Nincs aktív cég, amelynek tulajdonosa vagy.</p>}

          {archivedList.length > 0 && (
            <>
              <h2>Archivált cégek</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Cég</th><th>Archiválva</th><th /><th>Végleges törlés</th></tr></thead>
                  <tbody>
                    {archivedList.map(({ c, role }) => {
                      const purgeOk = canPurge(c.archivedAt, now);
                      return (
                        <tr key={c.id}>
                          <td><Link href={`/c/${c.id}`}><strong>{c.name}</strong></Link><div className="muted" style={{ fontSize: 12 }}>csak olvasható</div></td>
                          <td>{dt(c.archivedAt!)}</td>
                          <td>
                            {role === "owner" && (
                              <form action={restoreCompanyAction}>
                                <input type="hidden" name="companyId" value={c.id} />
                                <button>Visszaállítás</button>
                              </form>
                            )}
                          </td>
                          <td>
                            {role !== "owner" ? <span className="muted">csak a tulajdonos</span> : purgeOk ? (
                              <form action={purgeCompanyAction} className="form-grid" style={{ gap: 6 }}>
                                <input type="hidden" name="companyId" value={c.id} />
                                <label className="check"><input type="checkbox" name="retention" required /> A bizonylatok 8 éves megőrzéséről az exportból gondoskodtam</label>
                                <label className="check"><input type="checkbox" name="understand" required /> Tudomásul veszem, hogy a törlés végleges</label>
                                <input name="password" type="password" autoComplete="current-password" placeholder="jelszavad" required />
                                <button className="danger">Végleges törlés</button>
                              </form>
                            ) : <span className="muted">{daysUntilPurge(c.archivedAt!, now)} nap múlva kérhető</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted">A végleges törlés a cég minden adatát (számlák, tételek, partnerek, számlatükör, beállítások) visszavonhatatlanul eltávolítja; a tevékenységnapló bejegyzései megmaradnak.</p>
            </>
          )}
        </>
      )}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
