"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect } from "@/lib/action-utils";
import { withAudit } from "@/lib/audit";
import { openYear } from "@/lib/year-open";

/** v6.6.0 – Évnyitás: az előző üzleti év eredményének átvezetése (+ az év hónapjainak zárolása). */
export async function openYearAction(fd: FormData) {
  return withAudit("openYearAction", fd, () => openYearActionImpl(fd));
}

async function openYearActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const fy = Number(fd.get("fy"));
  const { user, role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/closing/open`, async () => {
    if (role !== "owner" && role !== "accountant") throw new Error("Nincs jogosultságod.");
    const r = await openYear(cid, fy, { userId: user.id, lockMonths: fd.get("lock") === "on" });
    revalidatePath(`/c/${cid}`, "layout");
    const amt = Math.abs(r.result).toLocaleString("hu-HU");
    const what = r.entry ? `${r.result > 0 ? "nyereség" : "veszteség"} (${amt} Ft) átvezetve: ${r.entry.number}` : "nem volt átvezetendő eredmény";
    return `/c/${cid}/closing/open?ok=${encodeURIComponent(`Évnyitás kész – ${fy}: ${what}.${fd.get("lock") === "on" ? " Az év hónapjai zárolva." : ""}`)}`;
  });
}
