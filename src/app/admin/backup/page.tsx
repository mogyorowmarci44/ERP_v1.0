import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { SubmitButton } from "@/components/SubmitButton";
import { fileStoreConfigured } from "@/lib/file-store";
import { listCloudBackups, KEEP } from "@/lib/cloud-backup";
import { cloudBackupAction } from "./actions";

export const dynamic = "force-dynamic";

const dtIso = (s: string | null) => (s ? new Date(s).toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
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
  const stored = { configured: fileStoreConfigured(), list: me.organizationId ? await listCloudBackups(me.organizationId).catch(() => []) : [] };
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

      <h2 id="tarolo">Mentés a tárolóba</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Egy gombnyomással az összes cég teljes mentése a fájltárolóba (Neon) kerül – nem kell letölteni és máshol tárolni. Cégenként a legutóbbi {KEEP} mentés
        marad meg, a régebbiek törlődnek. Időzítő nincs: nyomd meg havonta, minden évzárás után és nagyobb import előtt. A mentésfájl letölthető, és a lenti visszaállítással visszatölthető.
      </p>
      {!stored.configured ? (
        <div className="card muted">A fájltároló nincs beállítva (FILES_BUCKET és az AWS_… környezeti változók a Renderen).</div>
      ) : (
        <>
          <form action={cloudBackupAction} className="card row" style={{ gap: 10, alignItems: "center" }}>
            <SubmitButton className="primary" pendingText="Mentés folyamatban…">Mentés most</SubmitButton>
            <span className="muted">{stored.list.length ? `Legutóbbi: ${dtIso(stored.list[0].at)}` : "Még nincs tárolt mentés."}</span>
          </form>
          {stored.list.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Cég</th><th>Időpont</th><th className="num">Méret</th><th /></tr></thead>
                <tbody>
                  {stored.list.slice(0, 60).map((o) => (
                    <tr key={o.key}>
                      <td>{cos.find((c) => c.id === o.companyId)?.name ?? `#${o.companyId}`}</td>
                      <td>{dtIso(o.at)}</td>
                      <td className="num">{(o.size / 1024).toLocaleString("hu-HU", { maximumFractionDigits: 0 })} kB</td>
                      <td><a className="btn" href={`/admin/backup/cloud?key=${encodeURIComponent(o.key)}`}>Letöltés</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

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
