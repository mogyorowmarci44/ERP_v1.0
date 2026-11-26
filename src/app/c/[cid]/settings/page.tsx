import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { updateCompanyAction, lockPeriodAction, updateTaxProfileAction } from "../actions";
import { TaxProfileFields } from "@/components/TaxProfileFields";
import { ENTITY_LABEL, isPrivate } from "@/lib/entity";
import { ACTIVITY_LABEL, ACTIVITY_PROFILES } from "@/lib/activity";
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
    .select({ name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.companyId, cid));
  // v4.5.0 – Tagok és tisztségviselők (cégeknél)
  const people = priv ? [] : await listMembers(cid);
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
          <label title="Autókereskedés profilnál látszik az ÁrSugó, AutóMérleg, KészletMérleg, Gépkocsi készlet, különbözeti ÁFA kartonok és a jármű-EPR.">Tevékenységprofil
            <select name="activityProfile" defaultValue={company.activityProfile}>
              {ACTIVITY_PROFILES.map((p) => <option key={p} value={p}>{ACTIVITY_LABEL[p]}</option>)}
            </select>
          </label>
        )}
        {!priv && <label>Üzleti év kezdő hónapja<input name="fiscalYearStartMonth" type="number" min={1} max={12} defaultValue={company.fiscalYearStartMonth} /></label>}
        {!priv && (
          <>
            <label title="Ha a Tagok és tisztségviselők között van ügyvezető, az okiratokon ő szerepel.">Képviselő (szerződésekhez)<input name="representative" defaultValue={company.settings.representative ?? ""} placeholder="pl. Gálos Kristóf" /></label>
            <label>Beosztás<input name="representativeTitle" defaultValue={company.settings.representativeTitle ?? "ügyvezető"} /></label>
            <label>Szerződéskötés helye<input name="signPlace" defaultValue={company.settings.signPlace ?? ""} placeholder="pl. Mór" /></label>
            {company.activityProfile === "car_dealer" && (<>
            <label className="row" title="80/2023. Korm. r. 20. § (3a) – a választás egész naptári évre szól; tartalmazza az alkatrészek és a csomagolás díját is.">
              <input type="checkbox" name="eprFlatRate" defaultChecked={!!company.settings.eprFlatRate} /> EPR díjátalány (gépjármű)
            </label>
            </>)}
            <label title="A KPI-Dashboard és a cégérték időszaka ennél korábban nem kezdődik (az évesítés és a tavalyi összevetés is ettől számol).">Működés kezdete
              <input type="date" name="operationStart" defaultValue={company.settings.operationStart ?? ""} />
            </label>
            {company.activityProfile === "car_dealer" && <label title="A KF kód 8. karaktere külföldről behozott gépjárműre (80/2023. 1. melléklet 2.6).">EPR származáskód (KF 8. karakter)
              <input name="eprOriginDigit" maxLength={1} pattern="[0-9]" defaultValue={company.settings.eprOriginDigit ?? ""} placeholder="80/2023. 1. mell. 2.6" />
            </label>}
          </>
        )}
        <div style={{ alignSelf: "end" }}><button className="primary" disabled={role !== "owner"}>Mentés</button></div>
      </form>

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

      <h2>Időszak zárás</h2>
      <p className="muted">Lezárt hónapba (pl. beadott ÁFA bevallás után) nem lehet könyvelni. Visszanyitni csak tulajdonos tud.</p>
      <form action={lockPeriodAction} className="row card">
        <input type="hidden" name="cid" value={cid} />
        <label>Időszak<input type="month" name="period" defaultValue={today().slice(0, 7)} /></label>
        <button style={{ alignSelf: "end" }} name="unlock" value="0">Lezárás</button>
        <button style={{ alignSelf: "end" }} name="unlock" value="1" className="danger">Visszanyitás</button>
      </form>
      <p>Lezárt időszakok: {locks.length ? locks.map((l) => `${l.year}.${String(l.month).padStart(2, "0")}`).join(", ") : <span className="muted">nincs</span>}</p>

      <h2>Felhasználók</h2>
      <table>
        <thead><tr><th>Név</th><th>E-mail</th><th>Szerep</th></tr></thead>
        <tbody>{members.map((m) => <tr key={m.email}><td>{m.name}</td><td>{m.email}</td><td>{{ owner: "tulajdonos", accountant: "könyvelő", viewer: "CEO - Ügyvezető" }[m.role]}</td></tr>)}</tbody>
      </table>
      {role === "owner" && (
        <form action={addMemberAction} className="card form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="companyId" value={cid} />
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Név (új felhasználónál)<input name="name" /></label>
          <label>Szerep
            <select name="role" defaultValue="accountant">
              <option value="owner">tulajdonos</option><option value="accountant">könyvelő</option><option value="viewer">CEO - Ügyvezető</option>
            </select>
          </label>
          <div style={{ alignSelf: "end" }}><button>Hozzáadás</button></div>
        </form>
      )}
      {role === "owner" && <p className="muted" style={{ fontSize: 13 }}>Új e-mail címre meghívó link megy ki (7 napig érvényes) – a jelszót a meghívott maga állítja be.</p>}
    </>
  );
}
