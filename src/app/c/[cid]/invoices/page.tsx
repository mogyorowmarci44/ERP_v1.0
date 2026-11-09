import Link from "next/link";
import { and, desc, eq, gte, lte, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, isDate, yearStart, monthEnd, today } from "@/lib/dates";

const statusHu = { draft: "piszkozat", posted: "könyvelt", cancelled: "sztornózott" } as const;

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const dir = sp.dir === "in" ? "in" : "out";
  const from = isDate(sp.from) ? sp.from : yearStart();
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const q = (sp.q ?? "").trim();
  const conds = [eq(schema.invoices.companyId, cid), eq(schema.invoices.direction, dir), gte(schema.invoices.fulfillmentDate, from), lte(schema.invoices.fulfillmentDate, to)];
  if (q) conds.push(or(ilike(schema.invoices.invoiceNumber, `%${q}%`), ilike(schema.partners.name, `%${q}%`))!);
  const list = await db
    .select({ i: schema.invoices, partner: schema.partners.name })
    .from(schema.invoices)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
    .where(and(...conds))
    .orderBy(desc(schema.invoices.fulfillmentDate), desc(schema.invoices.id))
    .limit(1000);
  const posted = list.filter((x) => x.i.status === "posted");
  return (
    <>
      <div className="topbar">
        <h1>{dir === "out" ? "Vevőszámlák" : "Szállítói számlák"}</h1>
        <Link className="btn primary" href={`/c/${cid}/invoices/new?dir=${dir}`}>+ Új számla</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card" style={{ marginBottom: 12 }}>
        <input type="hidden" name="dir" value={dir} />
        <label>Teljesítés-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <label>Keresés<input name="q" defaultValue={q} placeholder="számlaszám / partner" /></label>
        <button style={{ alignSelf: "end" }}>Szűrés</button>
      </form>
      <table>
        <thead><tr><th>Számlaszám</th><th>Partner</th><th>Kelte</th><th>Teljesítés</th><th>Határidő</th><th className="num">Nettó Ft</th><th className="num">ÁFA Ft</th><th className="num">Végösszeg</th><th>Állapot</th></tr></thead>
        <tbody>
          {list.map(({ i, partner }) => (
            <tr key={i.id}>
              <td><Link href={`/c/${cid}/invoices/${i.id}`}>{i.invoiceNumber}</Link></td>
              <td>{partner}</td>
              <td>{fmtDate(i.issueDate)}</td>
              <td>{fmtDate(i.fulfillmentDate)}</td>
              <td>{fmtDate(i.dueDate)}</td>
              <td className="num">{fmtHuf(i.netHuf)}</td>
              <td className="num">{fmtHuf(i.vatHuf)}</td>
              <td className="num">{fmtMoney(i.grossFx, i.currency)}</td>
              <td><span className={`badge ${i.status}`}>{statusHu[i.status]}</span></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={9} className="muted">Nincs számla a megadott szűrésre.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Könyvelt összesen ({posted.length} db)</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.netHuf), 0))}</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.vatHuf), 0))}</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.grossHuf), 0))} Ft</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}
