import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { savePartnerAction } from "../actions";
import { Flash } from "@/components/Flash";

export default async function PartnersPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const list = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid)).orderBy(asc(schema.partners.name));
  const edit = sp.edit ? list.find((p) => p.id === Number(sp.edit)) : undefined;
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
      <h2>Lista ({list.length})</h2>
      <table>
        <thead><tr><th>Név</th><th>Adószám</th><th>Közösségi adószám</th><th>Ország</th><th>Típus</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td className="mono">{p.taxNumber}</td><td className="mono">{p.euVatNumber}</td><td>{p.country}</td>
              <td>{p.isPrivatePerson ? "magánszemély" : "cég"}</td>
              <td><Link href={`/c/${cid}/partners?edit=${p.id}`}>szerkesztés</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
