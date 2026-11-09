import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { saveAccountAction } from "../actions";
import { Flash } from "@/components/Flash";

const typeHu = { asset: "eszköz", liability: "kötelezettség", equity: "saját tőke", expense: "költség/ráfordítás", revenue: "bevétel", off_balance: "nyilvántartási" } as const;

export default async function AccountsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const list = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, cid)).orderBy(asc(schema.accounts.code));
  const edit = sp.edit ? list.find((a) => a.id === Number(sp.edit)) : undefined;
  return (
    <>
      <h1>Számlatükör</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={saveAccountAction} className="card form-grid" key={edit?.id ?? "new"}>
        <input type="hidden" name="cid" value={cid} />
        {edit ? (
          <>
            <input type="hidden" name="id" value={edit.id} />
            <label>Számlaszám<input value={edit.code} disabled /></label>
            <label>Megnevezés<input name="name" required defaultValue={edit.name} /></label>
            <label style={{ alignSelf: "end", display: "flex", gap: 6 }}><input type="checkbox" name="isActive" defaultChecked={edit.isActive} /> Aktív</label>
          </>
        ) : (
          <>
            <label>Számlaszám<input name="code" required pattern="\d+" placeholder="pl. 5291" /></label>
            <label>Megnevezés<input name="name" required /></label>
            <label>Típus
              <select name="type" defaultValue="expense">
                {Object.entries(typeHu).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Beszámoló sor (opc.)<input name="reportLine" placeholder="pl. IV.6" /></label>
          </>
        )}
        <div style={{ alignSelf: "end" }} className="row">
          <button className="primary">{edit ? "Mentés" : "Új főkönyvi számla"}</button>
          {edit && <Link href={`/c/${cid}/accounts`} className="btn">Mégse</Link>}
        </div>
      </form>
      <table style={{ marginTop: 16 }}>
        <thead><tr><th>Szám</th><th>Megnevezés</th><th>Típus</th><th>Beszámoló sor</th><th>Állapot</th><th></th></tr></thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id} style={a.isPosting ? undefined : { fontWeight: 600, background: "#f9fafb" }}>
              <td className="mono">{a.code}</td><td>{a.name}</td><td>{typeHu[a.type]}</td><td className="mono">{a.reportLine}</td>
              <td>{!a.isActive ? "inaktív" : a.isPosting ? "" : "gyűjtő"}</td>
              <td><Link href={`/c/${cid}/accounts?edit=${a.id}`}>szerk.</Link> · <Link href={`/c/${cid}/reports/ledger?account=${a.id}`}>karton</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
