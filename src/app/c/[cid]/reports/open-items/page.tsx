import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { openItems } from "@/lib/reports";
import { fmtMoney } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { lastReminders } from "@/lib/payment-reminder";
import { sendReminderAction, approveInvoiceAction } from "../../actions";
import { needsApproval, canApprove } from "@/lib/approval-calc";

export default async function OpenItemsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role, company } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [recv, pay] = await Promise.all([openItems(cid, "out"), openItems(cid, "in")]);
  const t = today();
  // v7.3.0 – lejárt vevőszámlák partnerenként → fizetési emlékeztető
  const overdue = recv.filter((r) => r.dueDate && r.dueDate < t && Number(r.openFx) > 0);
  const partnerIds = [...new Set(overdue.map((r) => r.partnerId))];
  const emails = new Map(
    (partnerIds.length ? await db.select({ id: schema.partners.id, email: schema.partners.email }).from(schema.partners).where(and(eq(schema.partners.companyId, cid), inArray(schema.partners.id, partnerIds))) : [])
      .map((p) => [p.id, p.email]),
  );
  const last = await lastReminders(cid, recv.map((r) => r.id));
  const groups = partnerIds.map((pid) => {
    const rows = overdue.filter((r) => r.partnerId === pid);
    const sent = rows.map((r) => last.get(r.id)).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return { pid, name: rows[0].partnerName, rows, email: emails.get(pid) ?? null, sent };
  });
  // v7.5.0 – jóváhagyásra váró szállítói számlák
  const appr = company.settings.approval;
  const payIds = pay.map((r) => r.id);
  const pendingRows = appr?.on && payIds.length
    ? await db.select({ id: schema.invoices.id, approvedAt: schema.invoices.approvedAt, grossHuf: schema.invoices.grossHuf, direction: schema.invoices.direction, status: schema.invoices.status })
        .from(schema.invoices).where(and(eq(schema.invoices.companyId, cid), inArray(schema.invoices.id, payIds)))
    : [];
  const pendingIds = new Set(pendingRows.filter((r) => needsApproval(appr, r)).map((r) => r.id));
  const dt = (d: Date) => d.toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest" });

  const table = (rows: typeof recv, withReminder: boolean) => (
    <table>
      <thead><tr><th>Számla</th><th>Partner</th><th>Kelte</th><th>Határidő</th><th className="num">Végösszeg</th><th className="num">Nyitott</th><th>Késés</th>{withReminder && <th>Emlékeztető</th>}</tr></thead>
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
              {withReminder && <td className="muted">{last.get(r.id) ? dt(last.get(r.id)!) : ""}</td>}
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={withReminder ? 8 : 7} className="muted">Nincs nyitott tétel.</td></tr>}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="topbar">
        <h1>Nyitott tételek</h1>
        <a className="btn no-print" href={`/c/${cid}/reports/pdf?type=open`} target="_blank" rel="noreferrer">PDF</a>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {groups.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Fizetési emlékeztető</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            Partnerenként egy udvarias levél a lejárt számlák listájával és a nyitott összeggel. A levélben a te neved és e-mail címed szerepel kapcsolattartóként.
            Ugyanarra a számlára {3} napon belül csak megerősítéssel megy újra.
          </p>
          <table>
            <thead><tr><th>Partner</th><th className="num">Lejárt számla</th><th>E-mail</th><th>Utoljára</th><th /></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.pid}>
                  <td>{g.name}</td>
                  <td className="num">{g.rows.length}</td>
                  <td>{g.email ?? <Link href={`/c/${cid}/partners?edit=${g.pid}`} className="muted">nincs – megadom</Link>}</td>
                  <td className="muted">{g.sent ? dt(g.sent) : "–"}</td>
                  <td>
                    {canWrite && g.email && (
                      <form action={sendReminderAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <input type="hidden" name="cid" value={cid} />
                        <input type="hidden" name="partnerId" value={g.pid} />
                        <input name="bankAccount" defaultValue={company.settings.reminderBankAccount ?? ""} placeholder="bankszámlaszám (nem kötelező)" style={{ width: 210 }} />
                        {g.sent && Date.now() - g.sent.getTime() < 3 * 86400000 && <label className="check"><input type="checkbox" name="force" value="1" /> újra</label>}
                        <SubmitButton pendingText="Küldés…">Emlékeztető</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pendingIds.size > 0 && (
        <div className="card fc-warn" style={{ marginBottom: 14 }}>
          <strong>{pendingIds.size} szállítói számla fizetés előtt jóváhagyásra vár</strong>
          <ul style={{ margin: "6px 0 0" }}>
            {pay.filter((r) => pendingIds.has(r.id)).map((r) => (
              <li key={r.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                <Link href={`/c/${cid}/invoices/${r.id}`}>{r.invoiceNumber}</Link> – {r.partnerName} – {fmtMoney(r.openFx, r.currency)}, esedékes {fmtDate(r.dueDate)}
                {canApprove(role) && (
                  <form action={approveInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="open" /><button>Jóváhagyom</button></form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h2>Vevők</h2>
      {table(recv, true)}
      <h2>Szállítók</h2>
      {table(pay, false)}
    </>
  );
}
