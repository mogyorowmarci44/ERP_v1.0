import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { ImportForm } from "@/components/ImportForm";
import { LoanTermsForm } from "@/components/LoanTermsForm";
import { Flash } from "@/components/Flash";
import { wipeCompanyAction } from "../actions";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
  return (
    <>
      <h1>Adatimport</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted">
        Régi nyilvántartásból (pl. Excel) átalakított import csomag betöltése. Számlák, kiegyenlítések, vegyes tételek, partnerek
        és gépkocsik kerülnek be, egyetlen lépésben: vagy minden bekerül, vagy semmi.
      </p>
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
        <ImportForm cid={cid} />
      )}
    </>
  );
}
