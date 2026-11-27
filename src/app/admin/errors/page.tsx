import Link from "next/link";
import { desc, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { resolveErrorAction } from "../actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { fileStoreConfigured } from "@/lib/file-store";
import { mailApiConfigured } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

const dt = (d: Date) => d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** v6.7.0 – Üzemeltetői hibanapló és rendszerállapot. */
export default async function ErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const showResolved = sp.resolved === "1";
  const rows = await db.select().from(schema.errorLog).where(showResolved ? isNotNull(schema.errorLog.resolvedAt) : isNull(schema.errorLog.resolvedAt)).orderBy(desc(schema.errorLog.lastAt)).limit(200);
  const env = [
    ["Fájltároló (Neon Object Storage)", fileStoreConfigured(), "FILES_BUCKET, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"],
    ["E-mail saját domainről (Brevo / Resend)", mailApiConfigured(), "MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM"],
    ["E-mail Gmail-továbbítón át (régi)", !!(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET), "MAIL_RELAY_URL, MAIL_RELAY_SECRET"],
    ["Adattitkosítás", !!process.env.DATA_ENCRYPTION_KEY, "DATA_ENCRYPTION_KEY"],
    ["Nyilvános cím", !!process.env.APP_URL, "APP_URL"],
  ] as const;
  return (
    <div className="main" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Hibanapló és rendszerállapot</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin/platform">← Ügyfélfiókok</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <h2>Beállítások</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {env.map(([label, ok, vars]) => (
              <tr key={label}><td>{label}</td><td>{ok ? <span className="badge posted">beállítva</span> : <span className="badge draft">nincs</span>}</td><td className="muted" style={{ fontSize: 12 }}>{vars}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Elérhetőség-figyeléshez (pl. UptimeRobot, ingyenes, 5 percenként) állítsd be ezt a címet: <code>/api/health</code> – az adatbázis-kapcsolatot is ellenőrzi,
        hiba esetén 503-at ad. Ugyanez ébren is tartja a Render ingyenes példányát.
      </p>

      <h2>{showResolved ? "Megoldott hibák" : "Nyitott hibák"} ({rows.length})</h2>
      <p><Link href={showResolved ? "?" : "?resolved=1"}>{showResolved ? "← nyitott hibák" : "megoldottak megtekintése →"}</Link></p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Utoljára</th><th className="num">Hányszor</th><th>Hiba</th><th>Hol</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{dt(r.lastAt)}<div className="muted" style={{ fontSize: 11 }}>először: {dt(r.at)}</div></td>
                <td className="num">{r.count}</td>
                <td style={{ maxWidth: 520 }}>
                  <strong style={{ fontSize: 13 }}>{r.message.slice(0, 300)}</strong>
                  {r.stack && <details><summary className="muted" style={{ fontSize: 12 }}>részletek</summary><pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{r.stack}</pre></details>}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r.method} {r.path}<div>{r.kind}{r.digest ? ` · ${r.digest}` : ""}</div></td>
                <td>{!r.resolvedAt && (
                  <form action={resolveErrorAction}><input type="hidden" name="id" value={r.id} /><button className="link">megoldva</button></form>
                )}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{showResolved ? "Nincs." : "Nincs nyitott hiba. 🎉"}</td></tr>}
          </tbody>
        </table>
      </div>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
