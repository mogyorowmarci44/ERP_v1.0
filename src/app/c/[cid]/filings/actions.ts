"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { deleteFiling, fillPartnerTaxFromFilings, importFilings, markLatestSubmitted, setSubmitted } from "@/lib/filings";
import { KIND_LABEL } from "@/lib/anyk";
import { withAudit } from "@/lib/audit";

const back = (cid: number, tab?: string) => `/c/${cid}/filings${tab ? `?tab=${tab}` : ""}`;
const ok = (url: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

export async function uploadFilingsAction(fd: FormData) {
  return withAudit("uploadFilingsAction", fd, () => uploadFilingsActionImpl(fd));
}

async function uploadFilingsActionImpl(fd: FormData) {
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
  return withAudit("markSubmittedAction", fd, () => markSubmittedActionImpl(fd));
}

async function markSubmittedActionImpl(fd: FormData) {
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
  return withAudit("deleteFilingAction", fd, () => deleteFilingActionImpl(fd));
}

async function deleteFilingActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), id = Number(fd.get("id")), tab = str(fd, "tab");
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, tab), async () => {
    await deleteFiling(cid, id);
    revalidatePath(`/c/${cid}/filings`);
    return ok(back(cid, tab), "Változat törölve.");
  });
}

export async function markLatestAction(fd: FormData) {
  return withAudit("markLatestAction", fd, () => markLatestActionImpl(fd));
}

async function markLatestActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), tab = str(fd, "tab");
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, tab), async () => {
    const n = await markLatestSubmitted(cid, tab === "payroll" ? "payroll" : "vat");
    revalidatePath(`/c/${cid}/filings`);
    return ok(back(cid, tab), `${n} időszakban a legutolsó mentett változat jelölve beküldöttként.`);
  });
}

export async function fillPartnerTaxAction(fd: FormData) {
  return withAudit("fillPartnerTaxAction", fd, () => fillPartnerTaxActionImpl(fd));
}

async function fillPartnerTaxActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), tab = str(fd, "tab");
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, tab), async () => {
    const r = await fillPartnerTaxFromFilings(cid);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back(cid, tab), r.updated.length ? `${r.updated.length} partner adószáma pótolva az M-lapokról: ${r.updated.slice(0, 12).join("; ")}${r.updated.length > 12 ? " …" : ""}` : `Nem volt pótolható partner (az M-lapokon ${r.known} partner szerepel).`);
  });
}

/**
 * ÁNYK Export: „Beküldve” – ha a hónapnak van betöltött változata, a legutolsót jelöli beküldöttnek; ha nincs, az ERP által
 * előállított XML-t (amit az ÁNYK-ba betöltöttél) eltárolja változatként, és azt jelöli beküldöttnek.
 */
export async function markExportSubmittedAction(fd: FormData) {
  return withAudit("markExportSubmittedAction", fd, () => markExportSubmittedActionImpl(fd));
}

async function markExportSubmittedActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period"), kind = str(fd, "kind") === "payroll" ? "payroll" : "vat";
  const date = str(fd, "date"), place = str(fd, "place");
  await requireCompany(cid, { write: true });
  const url = `/c/${cid}/filings?tab=revise&kind=${kind}${date ? `&date=${date}` : ""}${place ? `&place=${encodeURIComponent(place)}` : ""}`;
  await runOrRedirect(url, async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Hibás időszak.");
    const { filingsOverview } = await import("@/lib/filings");
    const o = await filingsOverview(cid);
    const row = (kind === "vat" ? o.vat : o.payroll).find((r) => r.period === period);
    let id: number | undefined;
    if (kind === "payroll" && row?.versions.length) id = row.versions.at(-1)!.id;
    else {
      const xml = kind === "payroll"
        ? (await (await import("@/lib/payroll-2608-data")).payroll2608Xml(cid, period)).xml
        : (await (await import("@/lib/vat-return-data")).vatXml(cid, period, date || undefined, place || null)).xml;
      const r = await importFilings(cid, [{ name: `${kind === "payroll" ? "2608" : "AFA"}_${period}_ERP.xml`, data: new TextEncoder().encode(xml) }]);
      id = r.ids[0];
      if (!id) throw new Error(r.skipped[0]?.reason ?? "Nem sikerült eltárolni.");
    }
    await setSubmitted(cid, id, true);
    revalidatePath(`/c/${cid}/filings`);
    return ok(url, `${period}: beküldöttként jelölve.`);
  });
}
