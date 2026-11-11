import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { docParties, loanMoneyKind, memberLoan } from "@/lib/member-loans";
import { AmendmentSheet, ContractSheet, RepaymentSheet } from "@/components/LoanDocs";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";

/**
 * Tagi kölcsön okiratai, nyomtatható A4 lapokon.
 *  - befizetés (TK): szerződés + módosítások (?doc=contract | M1 | M2 …, alapból mind) + a hozzá tartozó visszafizetések listája,
 *  - visszafizetés (TKV): visszafizetési bizonylat.
 */
export default async function LoanDocPage({ params, searchParams }: { params: Promise<{ cid: string; entryId: string }>; searchParams: Promise<Record<string, string>> }) {
  const p = await params;
  const sp = await searchParams;
  const cid = Number(p.cid);
  await requireCompany(cid);
  const found = await memberLoan(cid, Number(p.entryId));
  if (!found) notFound();
  const { member, loan } = found;
  const { company, member: m } = await docParties(cid, member.partnerId);
  const moneyKind = await loanMoneyKind(cid, loan.entryId);
  const back = <Link className="btn" href={`/c/${cid}/member-loans`}>← Tagi kölcsön</Link>;
  const repWarn = !company.representative && <p className="flash error no-print">A cég képviselője nincs megadva – Beállítások → Cégadatok → Képviselő.</p>;

  if (loan.kind === "repayment") {
    return (
      <>
        <div className="topbar no-print"><h1>{loan.docNo} – {member.name}</h1><div className="row">{back}<PrintButton /></div></div>
        {repWarn}
        <RepaymentSheet company={company} member={m} rep={loan} loans={member.rows} moneyKind={moneyKind} />
      </>
    );
  }

  if (!loan.dueDate) return <>{back}<p className="flash error">Ehhez a befizetéshez még nincs lejárat – a Tagi kölcsön oldalon add meg, utána elkészül a szerződés.</p></>;
  const doc = sp.doc ?? "all";
  const showContract = doc === "all" || doc === "contract";
  const exts = loan.extensions.filter((e) => doc === "all" || doc === `M${e.seq}`);
  return (
    <>
      <div className="topbar no-print"><h1>{loan.contractNo} – {member.name}</h1><div className="row">{back}<PrintButton /></div></div>
      <div className="tabs no-print" style={{ marginBottom: 12 }}>
        <Link className={doc === "all" ? "on" : ""} href="?doc=all">Mind</Link>
        <Link className={doc === "contract" ? "on" : ""} href="?doc=contract">Szerződés</Link>
        {loan.extensions.map((e) => <Link key={e.seq} className={doc === `M${e.seq}` ? "on" : ""} href={`?doc=M${e.seq}`}>{e.seq}. módosítás</Link>)}
      </div>
      {repWarn}
      {loan.repaidBy.length > 0 && (
        <p className="muted no-print">
          Visszafizetések:{" "}
          {loan.repaidBy.map((r, i) => <span key={r.entryId}>{i > 0 && ", "}<Link href={`/c/${cid}/member-loans/${r.entryId}`}>{r.docNo}</Link> ({fmtDate(r.date)}, {fmtHuf(r.amount)} Ft)</span>)}
        </p>
      )}
      {showContract && <ContractSheet company={company} member={m} loan={loan} moneyKind={moneyKind} />}
      {exts.map((e) => <AmendmentSheet key={e.seq} company={company} member={m} loan={loan} ext={e} />)}
    </>
  );
}
