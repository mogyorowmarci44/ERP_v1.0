import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";

/** v3.5.0 – a kezdőlap AutóMérleg-választójából: /c/:cid/vehicles/automerleg?vehicle=<id> → az autó AutóMérlege. */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  await requireCompany(cid);
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  const id = Number(new URL(req.url).searchParams.get("vehicle"));
  redirect(Number.isInteger(id) && id > 0 ? `/c/${cid}/vehicles/${id}/merleg` : `/c/${cid}/vehicles/merleg`);
}
