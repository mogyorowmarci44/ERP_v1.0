import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { docParties, memberLoansAsOf } from "@/lib/member-loans";
import { StatementSheet } from "@/components/LoanDocs";
import { PrintButton } from "@/components/PrintButton";
import { isDate, today } from "@/lib/dates";

/** Egyenlegközlő tagonként (?partner=ID, ?date=ÉÉÉÉ-HH-NN; partner nélkül minden tagnak). */
export default async function LoanStatementPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const asOf = isDate(sp.date) ? sp.date : today();
  const book = await memberLoansAsOf(cid, asOf);
  const members = book.members.filter((m) => !sp.partner || String(m.partnerId) === sp.partner);
  const sheets = await Promise.all(members.map(async (m) => ({ m, parties: await docParties(cid, m.partnerId) })));
  return (
    <>
      <div className="topbar no-print">
        <h1>Egyenlegközlő</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/member-loans`}>← Tagi kölcsön</Link>
          <form className="row" style={{ gap: 6 }}>
            {sp.partner && <input type="hidden" name="partner" value={sp.partner} />}
            <input type="date" name="date" defaultValue={asOf} aria-label="Fordulónap" />
            <button>Frissítés</button>
          </form>
          <PrintButton />
        </div>
      </div>
      {sheets.map(({ m, parties }) => (
        <StatementSheet key={String(m.partnerId)} company={parties.company} member={parties.member} rows={m.rows} asOf={asOf} balance={m.balance} fx={m.fx} />
      ))}
      {!sheets.length && <p className="muted">Ezen a napon nincs tagi kölcsön.</p>}
    </>
  );
}
