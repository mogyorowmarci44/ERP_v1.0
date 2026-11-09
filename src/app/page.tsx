import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createCompanyAction, logoutAction, changePasswordAction } from "./auth-actions";
import { Flash } from "@/components/Flash";
import { CompanyMark, Plate } from "@/components/Brand";
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
        theme: schema.companies.theme,
        logoUpdatedAt: schema.companies.logoUpdatedAt,
      },
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(schema.companies.name);

  return (
    <div className="main" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <Plate text="ERP" title="MM ERP" />
          <h1>Cégeim</h1>
        </div>
        <form action={logoutAction} className="row">
          <span className="muted">{user.name}</span>
          <button>Kilépés</button>
        </form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {list.length === 0 && <p className="muted">Még nincs cég. Hozd létre az elsőt lent – a számlatükör, ÁFA-kódok és naplók automatikusan betöltődnek.</p>}
      <div className="company-grid">
        {list.map(({ c, role }) => {
          const t = normalizeTheme(c.theme);
          return (
            <Link key={c.id} href={`/c/${c.id}`} className="card company-card">
              <div className="band" style={{ background: t.sidebar }}>
                <CompanyMark id={c.id} name={c.name} logoVersion={c.logoUpdatedAt ? c.logoUpdatedAt.getTime() : null} />
              </div>
              <div className="body">
                <strong>{c.name}</strong>
                <span className="muted">{c.taxNumber ?? "adószám nélkül"}</span>
                <span className="muted">ÁFA: {{ monthly: "havi", quarterly: "negyedéves", yearly: "éves" }[c.vatPeriod]} bevalló, szerep: {{ owner: "tulajdonos", accountant: "könyvelő", viewer: "csak olvasás" }[role]}</span>
              </div>
              <div style={{ height: 4, background: t.accent }} />
            </Link>
          );
        })}
      </div>

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
