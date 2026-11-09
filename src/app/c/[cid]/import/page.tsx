import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { ImportForm } from "@/components/ImportForm";

export default async function ImportPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company, role } = await requireCompany(cid);
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
  return (
    <>
      <h1>Adatimport</h1>
      <p className="muted">
        Régi nyilvántartásból (pl. Excel) átalakított import csomag betöltése. Számlák, kiegyenlítések, vegyes tételek, partnerek
        és gépkocsik kerülnek be, egyetlen lépésben: vagy minden bekerül, vagy semmi.
      </p>
      {role !== "owner" ? (
        <div className="flash error">Importálni csak a cég tulajdonosa tud.</div>
      ) : n > 0 ? (
        <div className="flash error">A(z) {company.name} cégnél már {n} könyvelési tétel van. Importálni csak üres cégbe lehet. Hozz létre egy új céget a főoldalon, és ott indítsd az importot.</div>
      ) : (
        <ImportForm cid={cid} />
      )}
    </>
  );
}
