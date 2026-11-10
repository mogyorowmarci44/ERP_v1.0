import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { marginCard } from "@/lib/margin-card";
import { MarginCardSheet } from "@/components/MarginCard";
import { PrintButton } from "@/components/PrintButton";

export default async function MarginCardPage({ params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  const card = await marginCard(cid, Number(p.id));
  if (!card) notFound();
  const printedAt = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  return (
    <>
      <div className="topbar no-print">
        <h1>Különbözeti ÁFA karton</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>← Gépkocsik</Link>
          <PrintButton />
        </div>
      </div>
      <MarginCardSheet card={card} cid={cid} printedAt={printedAt} />
    </>
  );
}
