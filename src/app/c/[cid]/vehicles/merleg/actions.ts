"use server";
/** v3.5.0 – KészletMérleg: hány napon belüli nullszaldó számít már „beavatkozni” (piros) állapotnak. */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";

export async function saveRedDaysAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { company } = await requireCompany(cid, { write: true });
  const days = Math.round(Number(String(fd.get("days") ?? "").replace(/[^0-9]/g, "")));
  const back = `/c/${cid}/vehicles/merleg`;
  if (!Number.isFinite(days) || days < 0 || days > 365) redirect(`${back}?error=${encodeURIComponent("0 és 365 közötti napszámot adj meg.")}`);
  await db.update(schema.companies).set({ settings: { ...company.settings, merlegRedDays: days } }).where(eq(schema.companies.id, cid));
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(`Mentve: ${days} napon belüli nullszaldó = piros.`)}`);
}
