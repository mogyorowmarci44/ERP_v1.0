import { ROLE_LABEL } from "@/lib/roles";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { updateCompanyAction, lockPeriodAction, updateTaxProfileAction, saveModulesAction, saveMemberModulesAction, saveApprovalSettingsAction, saveCostCenterAction } from "../actions";
import { TaxProfileFields } from "@/components/TaxProfileFields";
import { ENTITY_LABEL, isPrivate } from "@/lib/entity";
import { ACTIVITY_LABEL, ACTIVITY_PROFILES, isCarDealer } from "@/lib/activity";
import { MODULES, moduleDefault, moduleOn } from "@/lib/modules";
import { addMemberAction } from "@/app/auth-actions";
import { Flash } from "@/components/Flash";
import { today } from "@/lib/dates";
import { CompanyMembers } from "@/components/CompanyMembers";
import { listMembers } from "@/lib/company-members";
import { sql } from "drizzle-orm";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const priv = isPrivate(company);
  const locks = await db.select().from(schema.periodLocks).where(eq(schema.periodLocks.companyId, cid)).orderBy(asc(schema.periodLocks.year), asc(schema.periodLocks.month));
  const members = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, hidden: schema.memberships.hiddenModules })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.companyId, cid));
  // v4.5.0 – Tagok és tisztségviselők (cégeknél)
  const people = priv ? [] : await listMembers(cid);
  const centers = await db.select().from(schema.costCenters).where(eq(schema.costCenters.companyId, cid)).orderBy(asc(schema.costCenters.code));
  const appr = company.settings.approval ?? { on: false, threshold: 0 };
  const loanPartners = priv ? [] : ((await db.execute(sql`select distinct p.id, p.name from partners p
    where p.company_id = ${cid} and (p.id in (select l.partner_id from journal_lines l join accounts a on a.id = l.account_id where l.company_id = ${cid} and a.code like '479%')
      or p.id in (select partner_id from company_members where company_id = ${cid} and partner_id is not null)) order by p.name`)) as unknown as Array<{ id: number; name: string }>);
  return (
    <>
      <h1>Beállítások</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <h2>{priv ? "Alapadatok" : "Cégadatok"} <span className="entity-tag">{ENTITY_LABEL[company.entityType]}</span></h2>
      <form action={updateCompanyAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label>{priv ? "Megnevezés" : "Cégnév"}<input name="name" defaultValue={company.name} required /></label>
        <label>Adószám<input name="taxNumber" defaultValue={company.taxNumber ?? ""} /></label>
        <label>Közösségi adószám<input name="euVatNumber" defaultValue={company.euVatNumber ?? ""} /></label>
        {!priv && <label>Cégjegyzékszám<input name="registrationNumber" defaultValue={company.registrationNumber ?? ""} /></label>}
        <label>{priv ? "Szálláshely címe" : "Székhely"}<input name="address" defaultValue={company.address ?? ""} /></label>
        <label>ÁFA időszak
          <select name="vatPeriod" defaultValue={company.vatPeriod}>
            <option value="monthly">havi</option><option value="quarterly">negyedéves</option><option value="yearly">éves</option>
          </select>
        </label>
        {!priv && (
          <label title="A profil adja a modulok alapbeállítását; lent a Modulok résznél egyenként is kapcsolhatók.">Tevékenységprofil
            <select name="activityProfile" defaultValue={company.activityProfile}>
              {ACTIVITY_PROFILES.map((p) => <option key={p} value={p}>{ACTIVITY_LABEL[p]}</option>)}
            </select>
          </label>
        )}
        {!priv && <label>Üzleti év kezdő hónapja<input name="fiscalYearStartMonth" type="number" min={1} max={12} defaultValue={company.fiscalYearStartMonth} /></label>}
        {!priv && (
          <>
            <label title="Ha a Tagok és tisztségviselők között van ügyvezető, az okiratokon ő szerepel.">Képviselő (szerződésekhez)<input name="representative" defaultValue={company.settings.representative ?? ""} placeholder="pl. Kovács Anna" /></label>
            <label>Beosztás<input name="representativeTitle" defaultValue={company.settings.representativeTitle ?? "ügyvezető"} /></label>
            <label>Szerződéskötés helye<input name="signPlace" defaultValue={company.settings.signPlace ?? ""} placeholder="pl. Budapest" /></label>
            {isCarDealer(company) && (<>
            <label className="row" title="80/2023. Korm. r. 20. § (3a) – a választás egész naptári évre szól; tartalmazza az alkatrészek és a csomagolás díját is.">
              <input type="checkbox" name="eprFlatRate" defaultChecked={!!company.settings.eprFlatRate} /> EPR díjátalány (gépjármű)
            </label>
            </>)}
            <label title="A KPI-Dashboard és a cégérték időszaka ennél korábban nem kezdődik (az évesítés és a tavalyi összevetés is ettől számol).">Működés kezdete
              <input type="date" name="operationStart" defaultValue={company.settings.operationStart ?? ""} />
            </label>
            {isCarDealer(company) && <label title="A KF kód 8. karaktere külföldről behozott gépjárműre (80/2023. 1. melléklet 2.6).">EPR származáskód (KF 8. karakter)
              <input name="eprOriginDigit" maxLength={1} pattern="[0-9]" defaultValue={company.settings.eprOriginDigit ?? ""} placeholder="80/2023. 1. mell. 2.6" />
            </label>}
          </>
        )}
        <div style={{ alignSelf: "end" }}><button className="primary" disabled={role !== "owner"}>Mentés</button></div>
      </form>

      {!priv && (
        <>
          <h2 id="modulok">Modulok</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            A kikapcsolt modul eltűnik a menüből és a nyitóoldalról; az adatai megmaradnak. Az alapértelmezést a tevékenységprofil adja
            ({ACTIVITY_LABEL[company.activityProfile]}); az alap könyvelés mindig elérhető.
          </p>
          <form action={saveModulesAction} className="card">
            <input type="hidden" name="cid" value={cid} />
            <div className="form-grid">
              {MODULES.map((m) => (
                <label key={m.key} className="check" title={m.description}>
                  <input type="checkbox" name={`mod_${m.key}`} defaultChecked={moduleOn(company, m.key)} disabled={role !== "owner"} />{" "}
                  <span><strong>{m.label}</strong>{moduleOn(company, m.key) !== moduleDefault(company.activityProfile, m.key) && <span className="muted"> (eltér a profiltól)</span>}
                  <br /><span className="muted" style={{ fontSize: 12 }}>{m.description}</span></span>
                </label>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="primary" disabled={role !== "owner"}>Modulok mentése</button>
              <button name="reset" value="1" disabled={role !== "owner"}>Vissza a profil alapbeállítására</button>
            </div>
          </form>
        </>
      )}

      {priv && (
        <>
          <h2>Adózási profil</h2>
          <form action={updateTaxProfileAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} />
            <TaxProfileFields p={company.taxProfile} />
            <div style={{ alignSelf: "end" }}><button className="primary" disabled={role !== "owner"}>Mentés</button></div>
          </form>
        </>
      )}

      {!priv && <CompanyMembers cid={cid} list={people} selected={sp.member ?? null} partners={loanPartners} canWrite={role !== "viewer"} />}

      {/* v7.5.0 – jóváhagyás kifizetés előtt */}
      <h2 id="jovahagyas">Jóváhagyás kifizetés előtt</h2>
      <form action={saveApprovalSettingsAction} className="card row" style={{ gap: 14, alignItems: "end", flexWrap: "wrap" }}>
        <input type="hidden" name="cid" value={cid} />
        <label className="check"><input type="checkbox" name="on" defaultChecked={appr.on} disabled={role !== "owner"} /> Bejövő számla csak jóváhagyás után fizethető</label>
        <label>Ennyi bruttó forinttól (0 = mindegyik)<input name="threshold" inputMode="numeric" defaultValue={String(appr.threshold)} disabled={role !== "owner"} style={{ width: 140 }} /></label>
        {role === "owner" && <button>Mentés</button>}
        <p className="muted" style={{ flexBasis: "100%", margin: 0 }}>
          Bekapcsolva a könyvelt szállítói számlát a tulajdonos vagy az ügyvezető (CEO) hagyja jóvá a számla oldalán vagy a Nyitott tételek között; addig sem kézzel, sem a bankkivonat
          párosításával nem rendezhető. A könyvelő nem hagyhat jóvá (négy szem elve).
        </p>
      </form>

      {/* v7.5.0 – költséghelyek / projektek */}
      <h2 id="koltseghely">Költséghelyek / projektek</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Címke a számlasorokon és a vegyes tételeken (pl. telephely, autó, rendezvény, projekt). Az eredmény címkénként: Kimutatások › Költséghelyek.</p>
        {centers.length > 0 && (
          <table style={{ marginBottom: 10 }}>
            <thead><tr><th>Kód</th><th>Megnevezés</th><th>Állapot</th><th /></tr></thead>
            <tbody>
              {centers.map((c) => (
                <tr key={c.id} className={c.active ? undefined : "muted"}>
                  <td className="mono">{c.code}</td><td>{c.name}</td><td>{c.active ? "aktív" : "inaktív"}</td>
                  <td>{role !== "viewer" && (
                    <form action={saveCostCenterAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={c.id} />
                      <button name="op" value={c.active ? "off" : "on"}>{c.active ? "Inaktiválás" : "Aktiválás"}</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {role !== "viewer" && (
          <form action={saveCostCenterAction} className="row" style={{ gap: 8, alignItems: "end" }}>
            <input type="hidden" name="cid" value={cid} />
            <label>Kód<input name="code" required maxLength={20} style={{ width: 110 }} placeholder="pl. SZIG" /></label>
            <label style={{ flex: 1 }}>Megnevezés<input name="name" required maxLength={120} placeholder="pl. Szigetvári telephely" /></label>
            <button>Új költséghely</button>
          </form>
        )}
      </div>

      <h2>Időszak zárás</h2>
      <p className="muted">Lezárt hónapba (pl. beadott ÁFA bevallás után) nem lehet könyvelni. Visszanyitni csak tulajdonos tud.</p>
      <form action={lockPeriodAction} className="row card">
        <input type="hidden" name="cid" value={cid} />
        <label>Időszak<input type="month" name="period" defaultValue={today().slice(0, 7)} /></label>
        <button style={{ alignSelf: "end" }} name="unlock" value="0">Lezárás</button>
        <button style={{ alignSelf: "end" }} name="unlock" value="1" className="danger">Visszanyitás</button>
      </form>
      <p>Lezárt időszakok: {locks.length ? locks.map((l) => `${l.year}.${String(l.month).padStart(2, "0")}`).join(", ") : <span className="muted">nincs</span>}</p>

      <h2 id="felhasznalok">Felhasználók</h2>
      <table>
        <thead><tr><th>Név</th><th>E-mail</th><th>Szerep</th><th>Látható modulok</th></tr></thead>
        <tbody>{members.map((m) => {
          const avail = MODULES.filter((x) => moduleOn(company, x.key));
          const hid = m.hidden ?? [];
          return (
            <tr key={m.email}>
              <td>{m.name}</td><td>{m.email}</td><td>{ROLE_LABEL[m.role]}</td>
              <td>
                {m.role === "owner" ? <span className="muted">mind</span>
                  : m.role === "uploader" ? <span className="muted">csak a mobilos feltöltés (/p/{cid})</span>
                  : role === "owner" ? (
                    <details>
                      <summary>{avail.filter((x) => !hid.includes(x.key)).length} / {avail.length} modul</summary>
                      <form action={saveMemberModulesAction} style={{ marginTop: 6 }}>
                        <input type="hidden" name="cid" value={cid} /><input type="hidden" name="userId" value={m.id} />
                        {avail.map((x) => (
                          <label key={x.key} className="check" style={{ display: "block" }}>
                            <input type="checkbox" name={`see_${x.key}`} defaultChecked={!hid.includes(x.key)} /> {x.label}
                          </label>
                        ))}
                        <button style={{ marginTop: 6 }}>Mentés</button>
                      </form>
                    </details>
                  ) : <span className="muted">{avail.filter((x) => !hid.includes(x.key)).map((x) => x.label).join(", ") || "–"}</span>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="muted" style={{ fontSize: 13 }}>Az alap könyvelés (számlák, napló, ÁFA, kimutatások) mindenkinek látszik; a kiegészítő modulokat (pl. Bérszámfejtés) felhasználónként elrejtheted. A <strong>bizonylatfeltöltő</strong> csak telefonról tölthet fel számlát, a könyveléshez nem fér hozzá.</p>
      {role === "owner" && (
        <form action={addMemberAction} className="card form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="companyId" value={cid} />
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Név (új felhasználónál)<input name="name" /></label>
          <label>Szerep
            <select name="role" defaultValue="accountant">
              <option value="owner">tulajdonos</option><option value="accountant">könyvelő</option><option value="viewer">CEO - Ügyvezető</option><option value="uploader">bizonylatfeltöltő (csak mobilos feltöltés)</option>
            </select>
          </label>
          <div style={{ alignSelf: "end" }}><button>Hozzáadás</button></div>
        </form>
      )}
      {role === "owner" && <p className="muted" style={{ fontSize: 13 }}>Új e-mail címre meghívó link megy ki (7 napig érvényes) – a jelszót a meghívott maga állítja be.</p>}
    </>
  );
}
