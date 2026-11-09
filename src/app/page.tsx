import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createCompanyAction, logoutAction, changePasswordAction } from "./auth-actions";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const list = await db
    .select({ c: schema.companies, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(schema.companies.name);

  return (
    <div className="main" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="topbar">
        <h1>MM ERP</h1>
        <form action={logoutAction} className="row">
          <span className="muted">{user.name}</span>
          <button>Kilépés</button>
        </form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <h2>Cégeim</h2>
      <table>
        <thead><tr><th>Cég</th><th>Adószám</th><th>ÁFA időszak</th><th>Szerep</th></tr></thead>
        <tbody>
          {list.map(({ c, role }) => (
            <tr key={c.id}>
              <td><Link href={`/c/${c.id}`}>{c.name}</Link></td>
              <td className="mono">{c.taxNumber}</td>
              <td>{{ monthly: "havi", quarterly: "negyedéves", yearly: "éves" }[c.vatPeriod]}</td>
              <td>{role}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="muted">Még nincs cég – hozz létre egyet lent.</td></tr>}
        </tbody>
      </table>

      <h2>Új cég</h2>
      <form action={createCompanyAction} className="card form-grid">
        <label>Cégnév<input name="name" required placeholder="MM Cars Kft" /></label>
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
      <p className="muted">Új cég létrehozásakor betöltődik az alap számlatükör, ÁFA-kódok (köztük a különbözeti) és naplók.</p>

      <h2>Jelszócsere</h2>
      <form action={changePasswordAction} className="card form-grid">
        <label>Jelenlegi jelszó<input name="current" type="password" required /></label>
        <label>Új jelszó<input name="password" type="password" minLength={10} required /></label>
        <div style={{ alignSelf: "end" }}><button>Módosítás</button></div>
      </form>
    </div>
  );
}
