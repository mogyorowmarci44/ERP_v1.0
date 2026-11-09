import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { openItems } from "@/lib/reports";
import { fmtMoney } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";

export default async function OpenItemsPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  await requireCompany(cid);
  const [recv, pay] = await Promise.all([openItems(cid, "out"), openItems(cid, "in")]);
  const t = today();
  const table = (rows: typeof recv) => (
    <table>
      <thead><tr><th>Számla</th><th>Partner</th><th>Kelte</th><th>Határidő</th><th className="num">Végösszeg</th><th className="num">Nyitott</th><th>Késés</th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const late = r.dueDate && r.dueDate < t ? Math.round((Date.parse(t) - Date.parse(r.dueDate)) / 86400000) : 0;
          return (
            <tr key={r.id}>
              <td><Link href={`/c/${cid}/invoices/${r.id}`}>{r.invoiceNumber}</Link></td>
              <td>{r.partnerName}</td><td>{fmtDate(r.issueDate)}</td><td>{fmtDate(r.dueDate)}</td>
              <td className="num">{fmtMoney(r.grossFx, r.currency)}</td>
              <td className="num"><strong>{fmtMoney(r.openFx, r.currency)}</strong></td>
              <td style={{ color: late ? "var(--danger)" : undefined }}>{late ? `${late} nap` : ""}</td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={7} className="muted">Nincs nyitott tétel.</td></tr>}
      </tbody>
    </table>
  );
  return (
    <>
      <h1>Nyitott tételek</h1>
      <h2>Vevők</h2>
      {table(recv)}
      <h2>Szállítók</h2>
      {table(pay)}
    </>
  );
}
