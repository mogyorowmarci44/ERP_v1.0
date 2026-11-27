"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { withAudit } from "@/lib/audit";
import { importAccounts, importOpening, importPartners, readRows, type ImportReport } from "@/lib/onboarding";

/** v6.5.0 – Bevezető importok (ellenőrzés vagy betöltés); az eredmény sorai az Első lépések oldalon jelennek meg. */
export async function onboardingImportAction(fd: FormData) {
  return withAudit(`onboarding.${String(fd.get("kind"))}`, fd, () => onboardingImportActionImpl(fd));
}

async function onboardingImportActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user, role } = await requireCompany(cid, { write: true });
  const kind = String(fd.get("kind"));
  const apply = fd.get("apply") === "1";
  let r: ImportReport;
  try {
    if (role !== "owner" && role !== "accountant") throw new Error("Nincs jogosultságod.");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Válaszd ki a fájlt.");
    const rows = await readRows(f);
    if (kind === "opening") {
      const date = String(fd.get("date") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Add meg a nyitás napját.");
      r = await importOpening(cid, rows, { date, apply, userId: user.id });
    } else if (kind === "partners") r = await importPartners(cid, rows, apply);
    else if (kind === "accounts") r = await importAccounts(cid, rows, apply);
    else throw new Error("Ismeretlen import.");
  } catch (e) {
    r = { ok: false, messages: [e instanceof Error ? e.message : String(e)] };
  }
  if (r.ok && apply) revalidatePath(`/c/${cid}`, "layout");
  const q = new URLSearchParams({ k: kind, r: r.ok ? (apply ? "done" : "check") : "err", m: r.messages.join("\n").slice(0, 3500) });
  if (!r.ok) q.set("error", r.messages[0].slice(0, 300));
  redirect(`/c/${cid}/start?${q.toString()}#${kind}`);
}
