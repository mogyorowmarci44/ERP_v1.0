import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { accountLedger } from "@/lib/reports";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { isDate, yearStart, monthEnd, today, fmtDate } from "@/lib/dates";

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : yearStart();
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const accs = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, cid), eq(schema.accounts.isPosting, true))).orderBy(asc(schema.accounts.code));
  let accountId = Number(sp.account) || 0;
  if (accountId && !accs.some((a) => a.id === accountId)) accountId = 0;
  const data = accountId ? await accountLedger(cid, accountId, from, to) : null;
  return (
    <>
      <h1>Számlakarton</h1>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Főkönyvi számla
          <select name="account" defaultValue={accountId || ""} required>
            <option value="">– válassz –</option>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </label>
        <label>Dátum-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Lekérdezés</button>
      </form>
      {data && (
        <>
          <h2>{data.account.code} {data.account.name}</h2>
          <table>
            <thead><tr><th>Dátum</th><th>Tétel</th><th>Szöveg</th><th>Partner</th><th className="num">Deviza</th><th className="num">Tartozik</th><th className="num">Követel</th><th className="num">Egyenleg</th></tr></thead>
            <tbody>
              <tr className="sub"><td colSpan={7}>Nyitó egyenleg</td><td className="num">{fmtHuf(data.opening)}</td></tr>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDate(l.date)}</td>
                  <td className="mono">{l.number}</td>
                  <td>{l.description ?? l.entryDescription}</td>
                  <td>{l.partnerName}</td>
                  <td className="num">{l.currency ? fmtMoney(l.amountFx, l.currency) : ""}</td>
                  <td className="num">{l.debit ? fmtHuf(l.debit) : ""}</td>
                  <td className="num">{l.credit ? fmtHuf(l.credit) : ""}</td>
                  <td className="num">{fmtHuf(l.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Forgalom / záró egyenleg</td>
                <td className="num">{fmtHuf(data.lines.reduce((s, l) => s + Number(l.debit), 0))}</td>
                <td className="num">{fmtHuf(data.lines.reduce((s, l) => s + Number(l.credit), 0))}</td>
                <td className="num">{fmtHuf(data.closing)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="muted"><Link href={`/c/${cid}/reports/trial-balance?from=${from}&to=${to}`}>← vissza a főkönyvi kivonathoz</Link></p>
        </>
      )}
    </>
  );
}
