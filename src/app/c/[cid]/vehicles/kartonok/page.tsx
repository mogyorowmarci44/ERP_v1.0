import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { marginCard, soldVehicleIds } from "@/lib/margin-card";
import { MarginCardSheet } from "@/components/MarginCard";
import { PrintButton } from "@/components/PrintButton";
import { isDate, monthStart, monthEnd, today } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";

/** Egy időszakban eladott gépkocsik különbözeti ÁFA kartonjai egyben (oldaltöréssel) – a bevallás mellé. */
export default async function MarginCardsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : monthStart(today());
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const ids = await soldVehicleIds(cid, from, to);
  const cards = (await Promise.all(ids.map((id) => marginCard(cid, id)))).filter((c) => c !== null);
  const printedAt = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  const totVat = cards.reduce((a, c) => a + (c.sale?.vatBooked ?? 0), 0);
  return (
    <>
      <div className="topbar no-print">
        <h1>Különbözeti ÁFA kartonok</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>← Gépkocsik</Link>
          {cards.length > 0 && <PrintButton label={`${cards.length} karton nyomtatása / PDF`} />}
        </div>
      </div>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Eladás teljesítése -tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <button style={{ alignSelf: "end" }}>Szűrés</button>
        <span className="muted" style={{ alignSelf: "end" }}>{cards.length} eladott gépkocsi · különbözeti ÁFA összesen {fmtHuf(totVat)} Ft</span>
      </form>
      {cards.map((c) => <MarginCardSheet key={c.vehicle.id} card={c} cid={cid} printedAt={printedAt} />)}
      {cards.length === 0 && <p className="muted">Az időszakban nem volt különbözeti adózású eladás.</p>}
    </>
  );
}
