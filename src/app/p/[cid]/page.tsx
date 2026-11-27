import { APP_VERSION } from "@/lib/version";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { moduleOn } from "@/lib/modules";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { logoutAction } from "@/app/auth-actions";
import { portalUploadAction } from "./actions";

/**
 * v6.11.0 – Mobilos ügyfélportál: a bizonylatfeltöltő (pl. az ügyfél vagy a sofőr) telefonról lefotózza a számlát, és feltölti.
 * A könyveléshez nem fér hozzá – csak a saját feltöltéseit és azok állapotát látja.
 */
const STATUS: Record<string, string> = {
  new: "beérkezett", extracted: "beérkezett", review: "a könyvelőnél", booked: "lekönyvelve", duplicate: "már bent volt", ignored: "nem kell könyvelni", error: "a könyvelőnél",
};

export default async function PortalPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { user, company, role } = await requireCompany(cid, { portal: true });
  const mine = await db
    .select({ id: schema.inboxDocuments.id, filename: schema.inboxDocuments.filename, status: schema.inboxDocuments.status, createdAt: schema.inboxDocuments.createdAt, subject: schema.inboxDocuments.emailSubject })
    .from(schema.inboxDocuments)
    .where(and(eq(schema.inboxDocuments.companyId, cid), eq(schema.inboxDocuments.uploadedBy, user.id)))
    .orderBy(desc(schema.inboxDocuments.createdAt))
    .limit(30);
  const on = moduleOn(company, "inbox");
  const dt = (d: Date) => d.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="portal">
      <div className="portal-head">
        <ErpLogo size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="portal-company">{company.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>{user.name}</div>
        </div>
        <form action={logoutAction}><button>Kilépés</button></form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {!on ? (
        <div className="card">Ennél a cégnél a bizonylatgyűjtő ki van kapcsolva – szólj a könyvelődnek.</div>
      ) : (
        <form action={portalUploadAction} className="card portal-form">
          <input type="hidden" name="cid" value={cid} />
          <label className="portal-shot">
            <span>📷 Bizonylat fotózása</span>
            <input type="file" name="files" accept="image/*" capture="environment" multiple />
          </label>
          <label className="portal-file">
            <span>vagy fájl kiválasztása (PDF, kép)</span>
            <input type="file" name="files" accept="image/*,application/pdf" multiple />
          </label>
          <label>Mi ez? <small className="muted">(nem kötelező)</small>
            <input name="note" placeholder="pl. tankolás, alkatrész, bérleti díj" maxLength={120} />
          </label>
          <label>Típus
            <select name="kind" defaultValue="invoice"><option value="invoice">számla / nyugta</option><option value="statement">bankkivonat</option></select>
          </label>
          <SubmitButton className="primary" pendingText="Feltöltés…">Feltöltés</SubmitButton>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tipp: a teljes bizonylat látsszon, egyenesen, jó fényben. Több oldalt is fotózhatsz egyszerre.</p>
        </form>
      )}
      <h2 style={{ fontSize: 17, margin: "18px 0 8px" }}>Saját feltöltéseim</h2>
      {mine.length === 0 ? <p className="muted">Még nincs feltöltés.</p> : (
        <ul className="portal-list">
          {mine.map((d) => (
            <li key={d.id}>
              <div><strong>{d.subject?.replace(/^Mobil feltöltés:?\s*/, "") || d.filename}</strong><div className="muted" style={{ fontSize: 12 }}>{dt(d.createdAt)} · {d.filename}</div></div>
              <span className={`portal-status st-${d.status}`}>{STATUS[d.status] ?? d.status}</span>
            </li>
          ))}
        </ul>
      )}
      {role !== "uploader" && <p style={{ marginTop: 18 }}><Link href={`/c/${cid}`}>← Vissza a teljes nézetbe</Link></p>}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
