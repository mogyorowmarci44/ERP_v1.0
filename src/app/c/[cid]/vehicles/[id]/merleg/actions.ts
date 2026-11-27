"use server";
/** v3.4.0 – AutóMérleg: a tartási költség cégszintű alapértékeinek mentése. */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { withAudit } from "@/lib/audit";

export async function saveHoldingAction(fd: FormData) {
  return withAudit("saveHoldingAction", fd, () => saveHoldingActionImpl(fd));
}

async function saveHoldingActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), vid = Number(fd.get("vehicle"));
  const { company } = await requireCompany(cid, { write: true, module: "vehicles" });
  const n = (k: string) => Number(String(fd.get(k) ?? "").replace(",", ".").replace(/[^0-9.]/g, ""));
  const rate = n("rate"), fix = n("fix");
  const back = `/c/${cid}/vehicles/${vid}/merleg`;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !Number.isFinite(fix) || fix < 0 || fix > 1_000_000) redirect(`${back}?error=${encodeURIComponent("Hibás tartási költség.")}`);
  await db.update(schema.companies).set({ settings: { ...company.settings, holdingRatePct: rate, holdingFixPerDay: Math.round(fix) } }).where(eq(schema.companies.id, cid));
  revalidatePath(`/c/${cid}`, "layout");
  redirect(`${back}?ok=${encodeURIComponent("Tartási költség mentve a cég alapértékeként.")}`);
}
