import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { updateCompanyAction, lockPeriodAction } from "../actions";
import { addMemberAction } from "@/app/auth-actions";
import { Flash } from "@/components/Flash";
import { today } from "@/lib/dates";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const locks = await db.select().from(schema.periodLocks).where(eq(schema.periodLocks.companyId, cid)).orderBy(asc(schema.periodLocks.year), asc(schema.periodLocks.month));
  const members = await db
    .select({ name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.companyId, cid));
  return (
    <>
      <h1>Beállítások</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <h2>Cégadatok</h2>
      <form action={updateCompanyAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label>Cégnév<input name="name" defaultValue={company.name} required /></label>
        <label>Adószám<input name="taxNumber" defaultValue={company.taxNumber ?? ""} /></label>
        <label>Közösségi adószám<input name="euVatNumber" defaultValue={company.euVatNumber ?? ""} /></label>
        <label>Cégjegyzékszám<input name="registrationNumber" defaultValue={company.registrationNumber ?? ""} /></label>
        <label>Székhely<input name="address" defaultValue={company.address ?? ""} /></label>
        <label>ÁFA időszak
          <select name="vatPeriod" defaultValue={company.vatPeriod}>
            <option value="monthly">havi</option><option value="quarterly">negyedéves</option><option value="yearly">éves</option>
          </select>
        </label>
        <label>Üzleti év kezdő hónapja<input name="fiscalYearStartMonth" type="number" min={1} max={12} defaultValue={company.fiscalYearStartMonth} /></label>
        <label>Képviselő (szerződésekhez)<input name="representative" defaultValue={company.settings.representative ?? ""} placeholder="pl. Gálos Kristóf" /></label>
        <label>Beosztás<input name="representativeTitle" defaultValue={company.settings.representativeTitle ?? "ügyvezető"} /></label>
        <label>Szerződéskötés helye<input name="signPlace" defaultValue={company.settings.signPlace ?? ""} placeholder="pl. Mór" /></label>
        <div style={{ alignSelf: "end" }}><button className="primary" disabled={role !== "owner"}>Mentés</button></div>
      </form>

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
        <tbody>{members.map((m) => <tr key={m.email}><td>{m.name}</td><td>{m.email}</td><td>{m.role}</td></tr>)}</tbody>
      </table>
      {role === "owner" && (
        <form action={addMemberAction} className="card form-grid" style={{ marginTop: 12 }}>
          <input type="hidden" name="companyId" value={cid} />
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Név (új felhasználónál)<input name="name" /></label>
          <label>Kezdő jelszó (új felhasználónál)<input name="password" type="password" /></label>
          <label>Szerep
            <select name="role" defaultValue="accountant">
              <option value="owner">tulajdonos</option><option value="accountant">könyvelő</option><option value="viewer">csak olvasás</option>
            </select>
          </label>
          <div style={{ alignSelf: "end" }}><button>Hozzáadás</button></div>
        </form>
      )}
    </>
  );
}
