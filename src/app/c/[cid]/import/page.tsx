import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { ImportForm } from "@/components/ImportForm";
import { LoanTermsForm } from "@/components/LoanTermsForm";
import { isPrivate } from "@/lib/entity";
import { uploadSyncAction } from "../gh/actions";
import { Flash } from "@/components/Flash";
import { wipeCompanyAction } from "../actions";
import { DeltaImportForm } from "@/components/DeltaImportForm";
import { listBatches, KIND_HU } from "@/lib/delta-import";
import { firstEntryDate } from "@/lib/forecast-data";
import { today } from "@/lib/dates";
import { Download, FileSpreadsheet } from "lucide-react";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
  const [first, batches] = await Promise.all([firstEntryDate(cid), listBatches(cid)]);
  const from = first ?? `${today().slice(0, 4)}-01-01`;
  return (
    <>
      <h1>Adatimport és -export</h1>
      <Flash error={sp.error} ok={sp.ok} />

      <form action={`/c/${cid}/import/export`} method="get" data-progress="off" className="card grid" style={{ gap: 10, marginBottom: 16 }}>
        <strong>Adatexport</strong>
        <span className="muted">
          A könyvelés letöltése a választott időszakra: napló soronként, számlák tételekkel és kiegyenlítésekkel, partnerek, gépkocsik, tárgyi eszközök,
          záró egyenlegek, lezárt hónapok. A JSON-t add oda Claude-nak – abból készül a kiegészítő csomag; az Excel ugyanez olvasható formában.
        </span>
        <div className="row">
          <label>Ettől<input type="date" name="from" defaultValue={from} /></label>
          <label>Eddig<input type="date" name="to" defaultValue={today()} /></label>
          <button className="primary" name="fmt" value="json" style={{ alignSelf: "end" }}><Download size={16} /> Export (JSON)</button>
          <button name="fmt" value="xlsx" style={{ alignSelf: "end" }}><FileSpreadsheet size={16} /> Export (Excel)</button>
        </div>
      </form>

      {role === "owner" && (
        <div className="card grid" style={{ gap: 10, marginBottom: 16 }}>
          <strong>Kiegészítő csomag betöltése (mm-erp-delta/1)</strong>
          <span className="muted">
            A meglévő könyvelés mellé tölt be új tételeket (vegyes tétel, számla, kiegyenlítés, storno, tárgyi eszköz, ÉCS) – nem töröl semmit.
            Előbb előnézetet mutat a várható bizonylatszámokkal; a már betöltött tételeket kihagyja, lezárt hónapba nem könyvel. Vagy minden bekerül, vagy semmi.
          </span>
          <DeltaImportForm cid={cid} />
          {batches.length > 0 && (
            <details>
              <summary>Korábbi betöltések ({batches.length})</summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Időpont</th><th>Fájl</th><th>Megjegyzés</th><th className="num">Tétel</th><th>Tartalom</th></tr></thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td>{b.createdAt.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}</td>
                        <td className="small">{b.fileName}</td>
                        <td className="small">{b.note}</td>
                        <td className="num">{b.items}</td>
                        <td className="small">{Object.entries(b.summary).map(([k, v]) => `${v} ${KIND_HU[k] ?? k}`).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      <h2>Teljes import (üres cégbe)</h2>
      <p className="muted">
        Régi nyilvántartásból (pl. Excel) átalakított import csomag betöltése. Számlák, kiegyenlítések, vegyes tételek, partnerek
        és gépkocsik kerülnek be, egyetlen lépésben: vagy minden bekerül, vagy semmi.
      </p>
      {isPrivate(company) ? (
        <form action={uploadSyncAction} className="card grid" style={{ gap: 10, marginBottom: 16 }}>
          <input type="hidden" name="cid" value={cid} />
          <strong>Vendégház-szinkronfájl (foglalások, értékelések)</strong>
          <span className="muted">A vendégház-szinkronfájl (…-szinkron-….json) ide tölthető be – akkor is, ha a cégben már vannak könyvelési tételek. Többször is betölthető, nem duplázódik.</span>
          <div className="row">
            <input type="file" name="file" accept="application/json,.json" required />
            <button className="primary">Szinkronfájl betöltése</button>
          </div>
        </form>
      ) : null}
      {role !== "owner" ? (
        <div className="flash error">Importálni csak a cég tulajdonosa tud.</div>
      ) : n > 0 ? (
        <div className="grid" style={{ gap: 16 }}>
          <p>A(z) {company.name} cégnél már {n} könyvelési tétel van, ezért a teljes import itt nem futtatható (duplikálná az adatokat).</p>
          <LoanTermsForm cid={cid} />
          <form action={wipeCompanyAction} className="card grid" style={{ gap: 10, borderColor: "color-mix(in srgb, var(--neg) 40%, var(--line))" }}>
            <input type="hidden" name="cid" value={cid} />
            <strong className="neg">Könyvelési adatok törlése és újraimportálás</strong>
            <span className="muted">
              Törli a cég összes számláját, könyvelési tételét, kiegyenlítését, gépkocsiját, partnerét és tagi kölcsön lejáratát. A cég, a számlatükör,
              a téma, a logó és a felhasználók maradnak. Utána a teljes import újra futtatható. Nem visszavonható.
            </span>
            <div className="row">
              <label>A megerősítéshez írd be a cég nevét: <strong>{company.name}</strong><input name="confirm" autoComplete="off" required /></label>
              <button className="danger" style={{ alignSelf: "end" }}>Adatok végleges törlése</button>
            </div>
          </form>
        </div>
      ) : (
        <ImportForm cid={cid} doneHref={isPrivate(company) ? `/c/${cid}` : undefined} />
      )}
    </>
  );
}
