"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { deleteFiling, importFilings, setSubmitted } from "@/lib/filings";
import { KIND_LABEL } from "@/lib/anyk";

const back = (cid: number, tab?: string) => `/c/${cid}/filings${tab ? `?tab=${tab}` : ""}`;
const ok = (url: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

export async function uploadFilingsAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Nincs kiválasztott fájl.");
    const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const r = await importFilings(cid, data);
    revalidatePath(`/c/${cid}/filings`);
    const kinds = r.added.reduce<Record<string, number>>((a, x) => ({ ...a, [KIND_LABEL[x.kind]]: (a[KIND_LABEL[x.kind]] ?? 0) + 1 }), {});
    const parts = [
      `${r.added.length} bevallás betöltve${r.added.length ? ` (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")})` : ""}`,
      r.duplicates.length ? `${r.duplicates.length} már megvolt` : "",
      r.skipped.length ? `${r.skipped.length} kihagyva: ${summarizeSkips(r.skipped)}` : "",
    ].filter(Boolean);
    return ok(back(cid), parts.join(" · "));
  });
}

function summarizeSkips(sk: Array<{ file: string; reason: string }>) {
  const by: Record<string, number> = {};
  for (const x of sk) by[x.reason] = (by[x.reason] ?? 0) + 1;
  return Object.entries(by).map(([r, n]) => `${r} (${n})`).join("; ");
}

export async function markSubmittedAction(fd: FormData) {
  const cid = Number(fd.get("cid")), id = Number(fd.get("id")), on = fd.get("on") === "1", tab = str(fd, "tab");
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, tab), async () => {
    const receipt = str(fd, "receiptNo");
    await setSubmitted(cid, id, on, fd.has("receiptNo") ? (receipt || null) : undefined);
    revalidatePath(`/c/${cid}/filings`);
    return ok(back(cid, tab), on ? "Beküldöttként jelölve." : "Jelölés levéve.");
  });
}

export async function deleteFilingAction(fd: FormData) {
  const cid = Number(fd.get("cid")), id = Number(fd.get("id")), tab = str(fd, "tab");
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, tab), async () => {
    await deleteFiling(cid, id);
    revalidatePath(`/c/${cid}/filings`);
    return ok(back(cid, tab), "Változat törölve.");
  });
}
