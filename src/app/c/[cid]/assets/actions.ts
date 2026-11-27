"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str, optStr } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate } from "@/lib/dates";
import { createAsset, deleteAsset, postDepreciation, registerFromLine, updateAsset } from "@/lib/assets";
import { withAudit } from "@/lib/audit";

const back = (cid: number, q = "") => `/c/${cid}/assets${q}`;
const ok = (cid: number, msg: string, path = "") => `${back(cid, path)}?ok=${encodeURIComponent(msg)}`;

export async function registerLineAction(fd: FormData) {
  return withAudit("registerLineAction", fd, () => registerLineActionImpl(fd));
}

async function registerLineActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user } = await requireCompany(cid, { write: true, module: "assets" });
  await runOrRedirect(back(cid), async () => {
    const a = await registerFromLine(cid, Number(fd.get("lineId")), user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, a.method === "lowvalue"
      ? (a.status === "disposed" ? `${a.name} nyilvántartásba véve (a leírás már korábban könyvelve volt).` : `${a.name} nyilvántartásba véve és egy összegben leírva (T 572 / K ${a.accountCode.slice(0, 2)}9).`)
      : `${a.name} nyilvántartásba véve – a havi ÉCS-t az „ÉCS elszámolása” gomb könyveli.`, `/${a.id}`);
  });
}

export async function createAssetAction(fd: FormData) {
  return withAudit("createAssetAction", fd, () => createAssetActionImpl(fd));
}

async function createAssetActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user } = await requireCompany(cid, { write: true, module: "assets" });
  await runOrRedirect(back(cid, "/new"), async () => {
    const activationDate = str(fd, "activationDate");
    if (!isDate(activationDate)) throw new Error("Hibás aktiválási dátum.");
    if (!str(fd, "name")) throw new Error("Az eszköz neve kötelező.");
    const tax = str(fd, "taxRatePct");
    const a = await createAsset(cid, {
      name: str(fd, "name"), accountCode: str(fd, "accountCode"), activationDate, cost: parseNumber(fd.get("cost")),
      salvage: parseNumber(fd.get("salvage")), usefulLifeMonths: Math.round(parseNumber(fd.get("lifeYears")) * 12) || undefined,
      taxRatePct: tax === "" ? null : parseNumber(tax), inventoryNo: optStr(fd, "inventoryNo"), serialNo: optStr(fd, "serialNo"),
      location: optStr(fd, "location"), note: optStr(fd, "note"),
      openingAccumulated: parseNumber(fd.get("openingAccumulated")) || 0,
    }, { userId: user.id });
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, "Eszköz rögzítve.", `/${a.id}`);
  });
}

export async function updateAssetAction(fd: FormData) {
  return withAudit("updateAssetAction", fd, () => updateAssetActionImpl(fd));
}

async function updateAssetActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), id = Number(fd.get("id"));
  await requireCompany(cid, { write: true, module: "assets" });
  await runOrRedirect(back(cid, `/${id}`), async () => {
    const tax = str(fd, "taxRatePct");
    const life = Math.round(parseNumber(fd.get("lifeYears")) * 12);
    if (!(life > 0)) throw new Error("A hasznos élettartam legyen pozitív.");
    await updateAsset(cid, id, {
      name: str(fd, "name"), inventoryNo: optStr(fd, "inventoryNo"), serialNo: optStr(fd, "serialNo"), location: optStr(fd, "location"),
      note: optStr(fd, "note"), usefulLifeMonths: life, salvage: parseNumber(fd.get("salvage")), taxRatePct: tax === "" ? null : String(parseNumber(tax)),
    });
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, "Mentve. A módosítás a még el nem számolt hónapokra hat.", `/${id}`);
  });
}

export async function deleteAssetAction(fd: FormData) {
  return withAudit("deleteAssetAction", fd, () => deleteAssetActionImpl(fd));
}

async function deleteAssetActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), id = Number(fd.get("id"));
  await requireCompany(cid, { write: true, module: "assets" });
  await runOrRedirect(back(cid, `/${id}`), async () => {
    await deleteAsset(cid, id);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, "Eszköz törölve a nyilvántartásból.");
  });
}

export async function postDepreciationAction(fd: FormData) {
  return withAudit("postDepreciationAction", fd, () => postDepreciationActionImpl(fd));
}

async function postDepreciationActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user } = await requireCompany(cid, { write: true, module: "assets" });
  await runOrRedirect(back(cid), async () => {
    const r = await postDepreciation(cid, str(fd, "to"), user.id);
    revalidatePath(`/c/${cid}`, "layout");
    const msg = r.posted.length ? `ÉCS könyvelve: ${r.posted.map((p) => `${p.period} (${p.number})`).join(", ")}.` : "Nem volt elszámolandó ÉCS.";
    return ok(cid, msg + (r.skipped.length ? ` Lezárt hónap miatt kihagyva: ${r.skipped.join(", ")}.` : ""));
  });
}
