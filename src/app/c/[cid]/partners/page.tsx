import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { savePartnerAction } from "../actions";
import { Flash } from "@/components/Flash";
import { Pager, pageOf } from "@/components/Pager";

const PAGE = 100;

export default async function PartnersPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const list = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid)).orderBy(asc(schema.partners.name));
  const edit = sp.edit ? list.find((p) => p.id === Number(sp.edit)) : undefined;
  // v7.0.0 – keresés (név, adószám, e-mail, cím) és lapozás
  const q = (sp.q ?? "").trim().toLocaleLowerCase("hu");
  const qDigits = q.replace(/\D/g, "");
  const shown = q ? list.filter((p) => [p.name, p.email, p.address, p.euVatNumber].some((x) => (x ?? "").toLocaleLowerCase("hu").includes(q))
    || (qDigits.length >= 3 && (p.taxNumber ?? "").replace(/\D/g, "").includes(qDigits))) : list;
  const page = pageOf(sp.page, shown.length, PAGE);
  const rows = shown.slice((page - 1) * PAGE, page * PAGE);
  return (
    <>
      <h1>Partnerek</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={savePartnerAction} className="card form-grid" key={edit?.id ?? "new"}>
        <input type="hidden" name="cid" value={cid} />
        {edit && <input type="hidden" name="id" value={edit.id} />}
        <label>Név<input name="name" required defaultValue={edit?.name} /></label>
        <label>Adószám<input name="taxNumber" defaultValue={edit?.taxNumber ?? ""} /></label>
        <label>Közösségi adószám<input name="euVatNumber" defaultValue={edit?.euVatNumber ?? ""} /></label>
        <label>Ország (ISO)<input name="country" maxLength={2} defaultValue={edit?.country ?? "HU"} /></label>
        <label>Cím<input name="address" defaultValue={edit?.address ?? ""} /></label>
        <label>E-mail<input name="email" type="email" defaultValue={edit?.email ?? ""} /></label>
        <label style={{ alignSelf: "end", display: "flex", gap: 6 }}><input type="checkbox" name="isPrivatePerson" defaultChecked={edit?.isPrivatePerson} /> Magánszemély</label>
        <div style={{ alignSelf: "end" }} className="row">
          <button className="primary">{edit ? "Mentés" : "Új partner"}</button>
          {edit && <Link href={`/c/${cid}/partners`} className="btn">Mégse</Link>}
        </div>
      </form>
      <h2>Lista ({q ? `${shown.length} / ${list.length}` : list.length})</h2>
      <form className="row no-print" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Keresés: név, adószám, e-mail, cím…" style={{ flex: 1, minWidth: 220 }} />
        <button>Keresés</button>
        {q && <Link className="btn" href={`/c/${cid}/partners`}>Szűrés törlése</Link>}
      </form>
      <Pager page={page} size={PAGE} total={shown.length} query={{ q: sp.q || undefined }} />
      <table>
        <thead><tr><th>Név</th><th>Adószám</th><th>Közösségi adószám</th><th>Ország</th><th>Típus</th><th></th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td className="mono">{p.taxNumber}</td><td className="mono">{p.euVatNumber}</td><td>{p.country}</td>
              <td>{p.isPrivatePerson ? "magánszemély" : "cég"}</td>
              <td><Link href={`/c/${cid}/partners?edit=${p.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${page > 1 ? `&page=${page}` : ""}`}>szerkesztés</Link></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">{q ? "Nincs találat." : "Még nincs partner."}</td></tr>}
        </tbody>
      </table>
      <Pager page={page} size={PAGE} total={shown.length} query={{ q: sp.q || undefined }} />
    </>
  );
}
