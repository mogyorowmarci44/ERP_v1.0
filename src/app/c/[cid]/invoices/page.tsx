import Link from "next/link";
import { and, desc, eq, gte, lte, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, isDate, yearStart, monthEnd, today } from "@/lib/dates";
import { invoiceAudit } from "@/lib/invoice-audit";
import { toggleInvoiceCheckAction } from "../actions";

const statusHu = { draft: "piszkozat", posted: "könyvelt", cancelled: "sztornózott" } as const;

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const chk = sp.check === "unchecked" || sp.check === "flagged" ? sp.check : "all";
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
  const audit = new Map((await invoiceAudit(cid, { ids: list.map((x) => x.i.id) })).map((a) => [a.inv.id, a]));
  const shown = list.filter(({ i }) => {
    const a = audit.get(i.id);
    if (chk === "unchecked") return !a?.check.checked && i.status !== "cancelled";
    if (chk === "flagged") return a?.flags.some((f) => f.level === "warn");
    return true;
  });
  const posted = shown.filter((x) => x.i.status === "posted");
  const nUnchecked = list.filter(({ i }) => i.status !== "cancelled" && !audit.get(i.id)?.check.checked).length;
  const nFlagged = list.filter(({ i }) => audit.get(i.id)?.flags.some((f) => f.level === "warn")).length;
  const qs = (o: Record<string, string>) => new URLSearchParams({ dir, from, to, ...(q ? { q } : {}), check: chk, ...o }).toString();
  const back = `/c/${cid}/invoices?${qs({})}`;
  return (
    <>
      <div className="topbar">
        <h1>{dir === "out" ? "Vevőszámlák" : "Szállítói számlák"}</h1>
        <div className="row no-print">
          <a className="btn" href={`/c/${cid}/invoices/export?${new URLSearchParams({ from, to, dir })}`}>Excel – {dir === "out" ? "vevőszámlák" : "szállítói számlák"}</a>
          <a className="btn" href={`/c/${cid}/invoices/export?${new URLSearchParams({ from, to, dir: "all" })}`}>Excel – mind</a>
          <Link className="btn primary" href={`/c/${cid}/invoices/new?dir=${dir}`}>+ Új számla</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card" style={{ marginBottom: 12 }}>
        <input type="hidden" name="dir" value={dir} />
        <label>Teljesítés-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <label>Keresés<input name="q" defaultValue={q} placeholder="számlaszám / partner" /></label>
        <input type="hidden" name="check" value={chk} />
        <button style={{ alignSelf: "end" }}>Szűrés</button>
      </form>
      <div className="segmented no-print" style={{ marginBottom: 12 }}>
        <Link href={`/c/${cid}/invoices?${qs({ check: "all" })}`} className={chk === "all" ? "on" : undefined}>Mind ({list.length})</Link>
        <Link href={`/c/${cid}/invoices?${qs({ check: "unchecked" })}`} className={chk === "unchecked" ? "on" : undefined}>Nem ellenőrzött ({nUnchecked})</Link>
        <Link href={`/c/${cid}/invoices?${qs({ check: "flagged" })}`} className={chk === "flagged" ? "on" : undefined}>Jelzett ({nFlagged})</Link>
      </div>
      <table>
        <thead><tr><th>Számlaszám</th><th>Partner</th><th>Kelte</th><th>Teljesítés</th><th>Határidő</th><th className="num">Nettó Ft</th><th className="num">ÁFA Ft</th><th className="num">Végösszeg</th><th>Állapot</th><th>Jelzés</th><th className="no-print">Ellenőrizve</th></tr></thead>
        <tbody>
          {shown.map(({ i, partner }) => { const a = audit.get(i.id); const warns = a?.flags.filter((f) => f.level === "warn") ?? []; return (
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
              <td>{warns.length > 0 ? <span className="badge soon" title={warns.map((f) => f.text).join("\n")}>⚠ {warns.length}</span> : a?.check.docUrl ? <a href={a.check.docUrl} target="_blank" rel="noreferrer">bizonylat</a> : ""}</td>
              <td className="no-print">
                {i.status !== "cancelled" && (canWrite ? (
                  <form action={toggleInvoiceCheckAction}>
                    <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} />
                    <input type="hidden" name="on" value={a?.check.checked ? "0" : "1"} />
                    <button className={`chk${a?.check.checked ? " on" : ""}`} title={a?.check.checked ? `Ellenőrizte: ${a.check.by ?? ""} – kattintásra visszavonás` : a?.check.stale ? "Az ellenőrzés óta módosult – pipáld újra" : "Megjelölés ellenőrzöttként"}>
                      {a?.check.checked ? "✓" : a?.check.stale ? "!" : ""}
                    </button>
                  </form>
                ) : a?.check.checked ? "✓" : "")}
              </td>
            </tr>
          ); })}
          {shown.length === 0 && <tr><td colSpan={11} className="muted">Nincs számla a megadott szűrésre.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Könyvelt összesen ({posted.length} db)</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.netHuf), 0))}</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.vatHuf), 0))}</td>
            <td className="num">{fmtHuf(posted.reduce((s, x) => s + Number(x.i.grossHuf), 0))} Ft</td>
            <td colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}
