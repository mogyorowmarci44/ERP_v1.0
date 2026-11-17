import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { eprCard } from "@/lib/epr-card";
import { EprCardSheet } from "@/components/EprCard";
import { PrintButton } from "@/components/PrintButton";

export default async function EprCardPage({ params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  const card = await eprCard(cid, Number(p.id));
  if (!card) notFound();
  const printedAt = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  return (
    <>
      <div className="topbar no-print">
        <h1>EPR karton</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/vehicles?edit=${card.vehicle.id}`}>EPR adatok szerkesztése</Link>
          <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>← Gépkocsik</Link>
          <PrintButton />
        </div>
      </div>
      <EprCardSheet card={card} cid={cid} printedAt={printedAt} />
    </>
  );
}
