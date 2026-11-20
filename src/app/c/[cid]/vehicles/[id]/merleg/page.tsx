import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { AutoMerlegView } from "@/components/AutoMerleg";
import { loadAutoMerleg } from "@/lib/auto-merleg";
import { saveHoldingAction } from "./actions";

export const dynamic = "force-dynamic";

/** v3.4.0 – AutóMérleg: egy autó teljes mérlege (készleten élő számok, eladva lezárt elszámolás). */
export default async function AutoMerlegPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { cid: c, id } = await params;
  const sp = await searchParams;
  const cid = Number(c);
  const { role } = await requireCompany(cid);
  const data = await loadAutoMerleg(cid, Number(id));
  if (!data) notFound();
  return (
    <>
      <Flash error={sp.error} ok={sp.ok} />
      <AutoMerlegView input={data.input} meta={data.meta} cid={cid} canWrite={role !== "viewer"} saveHolding={saveHoldingAction} />
    </>
  );
}
