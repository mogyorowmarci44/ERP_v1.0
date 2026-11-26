import Link from "next/link";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { actionLabel } from "@/lib/audit-calc";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const PAGE = 100;
const dt = (d: Date) => d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** v6.0.0 – Tevékenységnapló: az ügyfélfiók minden belépése, módosítása, exportja – csak olvasható. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const { auditLog, companies } = schema;
  const cos = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.organizationId, me.organizationId)).orderBy(companies.name);
  const where: SQL[] = [eq(auditLog.organizationId, me.organizationId)];
  const cid = Number(sp.company);
  if (cid) where.push(eq(auditLog.companyId, cid));
  if (sp.fail === "1") where.push(eq(auditLog.ok, false));
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "")) where.push(gte(auditLog.at, new Date(`${sp.from}T00:00:00+01:00`)));
  const before = Number(sp.before);
  if (before) where.push(lt(auditLog.id, before));
  const rows = await db.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.id)).limit(PAGE + 1);
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const coName = new Map(cos.map((c) => [c.id, c.name]));
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ company: sp.company, fail: sp.fail, from: sp.from, ...extra })) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Tevékenységnapló</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link></div>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Ki, mikor, honnan mit csinált: belépések (a sikertelenek is), könyvelési és beállítási műveletek, hozzáférés-változások, exportok,
        archiválás és törlés. A napló nem módosítható és nem törölhető; a törölt cégek és felhasználók bejegyzései is megmaradnak.
      </p>
      <form className="card row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label>Cég
          <select name="company" defaultValue={sp.company ?? ""}>
            <option value="">mind</option>
            {cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Dátumtól<input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
        <label className="check"><input type="checkbox" name="fail" value="1" defaultChecked={sp.fail === "1"} /> csak a sikertelenek</label>
        <button>Szűrés</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Időpont</th><th>Felhasználó</th><th>Cég</th><th>Művelet</th><th>Részletek</th><th>IP</th></tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const d = (r.details ?? {}) as Record<string, unknown>;
              const { message, ...rest } = d;
              const restTxt = Object.entries(rest).filter(([k]) => k !== "cid").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{dt(r.at)}</td>
                  <td style={{ fontSize: 13 }}>{r.userEmail ?? <span className="muted">–</span>}</td>
                  <td style={{ fontSize: 13 }}>{r.companyId ? coName.get(r.companyId) ?? `#${r.companyId} (törölve)` : <span className="muted">–</span>}</td>
                  <td>
                    {r.ok ? actionLabel(r.action) : <span style={{ color: "var(--danger, #b42318)" }}>✕ {actionLabel(r.action)}</span>}
                    {r.target && <div className="muted" style={{ fontSize: 12 }}>{r.target}</div>}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 360 }}>
                    {message ? <div>{String(message)}</div> : null}
                    {restTxt && <div className="muted">{restTxt}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.ip ?? ""}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={6} className="muted">Nincs bejegyzés.</td></tr>}
          </tbody>
        </table>
      </div>
      {more && <p><Link href={qs({ before: list[list.length - 1].id })}>Régebbiek →</Link></p>}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
