import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const dt = (d: Date | null) => (d ? d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "még nem volt");

/** v6.1.0 – Mentés és visszaállítás: teljes cégmentés letöltése, visszaállítás mentésfájlból. */
export default async function BackupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const cos = await db
    .select({ id: schema.companies.id, name: schema.companies.name, last: schema.companies.lastFullExportAt, archivedAt: schema.companies.archivedAt })
    .from(schema.companies)
    .where(and(eq(schema.companies.organizationId, me.organizationId)))
    .orderBy(asc(schema.companies.name));
  return (
    <div className="main" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Mentés és visszaállítás</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <h2>Teljes cégmentés letöltése</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        A mentés a cég <strong>minden</strong> adatát tartalmazza: főkönyv, számlák és tételeik, kiegyenlítések, beszkennelt bizonylatok, partnerek,
        számlatükör, bérszámfejtés, tárgyi eszközök, tagi kölcsönök, forecast, bevallások, beállítások és logó. Tömörített JSON (.json.gz), bármikor
        visszaállítható ide. Tárold biztonságos helyen – személyes adatokat is tartalmaz. Javaslat: havonta, és minden évzárás után.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cég</th><th>Utolsó teljes mentés</th><th /></tr></thead>
          <tbody>
            {cos.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong>{c.archivedAt && <span className="badge draft" style={{ marginLeft: 6 }}>archivált</span>}</td>
                <td>{dt(c.last)}</td>
                <td><a className="btn" href={`/c/${c.id}/backup`}>Mentés letöltése</a></td>
              </tr>
            ))}
            {cos.length === 0 && <tr><td colSpan={3} className="muted">Nincs cég.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Visszaállítás mentésből</h2>
      <form action="/admin/backup/restore" method="post" encType="multipart/form-data" className="card row" style={{ gap: 10 }}>
        <input type="file" name="file" accept=".gz,.json,application/gzip,application/json" required />
        <button className="primary">Visszaállítás</button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>
        A cég az eredeti azonosítóival kerül vissza ebbe az ügyfélfiókba, és te leszel a tulajdonosa; minden belső hivatkozás érvényes marad.
        Csak olyan cég állítható vissza, amely <strong>nincs</strong> az adatbázisban (véglegesen törölt cég, vagy katasztrófa után új adatbázis) –
        archivált céget a Cégeim oldalon kell visszaállítani. A visszaállítás egyetlen lépésben történik: ha bármi hiba van, semmi nem változik.
      </p>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
