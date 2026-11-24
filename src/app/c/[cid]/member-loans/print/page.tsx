import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { docParties, loanMoneyKind, memberLoans } from "@/lib/member-loans";
import { AmendmentSheet, ContractSheet, RepaymentSheet } from "@/components/LoanDocs";
import { PrintButton } from "@/components/PrintButton";
import { parseDocKeys } from "@/lib/loan-doc-keys";

/** v4.5.1 – Tagi kölcsön: a kijelölt okiratok egyben, A4 oldalanként (?d=c:123,m:123:1,r:456). */
export default async function LoanPrintPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const keys = parseDocKeys(sp.d ?? "");
  const book = await memberLoans(cid);
  const find = (entryId: number) => {
    for (const m of book.members) {
      const r = m.rows.find((x) => x.entryId === entryId && x.kind !== "reval");
      if (r) return { member: m, loan: r };
    }
    return null;
  };
  const partiesCache = new Map<number | null, Awaited<ReturnType<typeof docParties>>>();
  const parties = async (pid: number | null) => {
    if (!partiesCache.has(pid)) partiesCache.set(pid, await docParties(cid, pid));
    return partiesCache.get(pid)!;
  };
  const sheets: React.ReactNode[] = [];
  for (const k of keys) {
    const f = find(k.entryId);
    if (!f) continue;
    const { company, member: m } = await parties(f.member.partnerId);
    if (k.kind === "r" && f.loan.kind === "repayment") {
      sheets.push(<RepaymentSheet key={`r${k.entryId}`} company={company} member={m} rep={f.loan} loans={f.member.rows} moneyKind={await loanMoneyKind(cid, k.entryId)} />);
    } else if (k.kind === "c" && f.loan.kind === "loan" && f.loan.dueDate) {
      sheets.push(<ContractSheet key={`c${k.entryId}`} company={company} member={m} loan={f.loan} moneyKind={await loanMoneyKind(cid, k.entryId)} />);
    } else if (k.kind === "m" && f.loan.kind === "loan") {
      const ext = f.loan.extensions.find((e) => e.seq === k.seq);
      if (ext) sheets.push(<AmendmentSheet key={`m${k.entryId}-${k.seq}`} company={company} member={m} loan={f.loan} ext={ext} />);
    }
  }
  return (
    <>
      <div className="topbar no-print">
        <h1>Tagi kölcsön – {sheets.length} dokumentum</h1>
        <div className="row"><Link className="btn" href={`/c/${cid}/member-loans?view=all`}>← Áttekintés</Link>{sheets.length > 0 && <PrintButton />}</div>
      </div>
      {sheets.length ? sheets : <p className="muted">Nincs kijelölt dokumentum.</p>}
    </>
  );
}
