import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { exportUserData } from "@/lib/privacy";
import { today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** v7.6.0 – a saját személyes adatok letöltése (JSON). */
export async function GET() {
  const user = await requireUser();
  const data = await exportUserData(user.id);
  await audit({ action: "account.export", user: { id: user.id, email: user.email, organizationId: user.organizationId } });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="sajat-adataim_${today()}.json"`, "Cache-Control": "no-store" },
  });
}
