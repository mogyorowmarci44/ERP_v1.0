"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, optStr } from "@/lib/action-utils";
import { addDocument } from "@/lib/inbox/service";
import { moduleOn } from "@/lib/modules";
import { withAudit } from "@/lib/audit";

const MAX_MB = 20;

/** v6.11.0 – mobilos ügyfélportál: fotó / PDF feltöltése a Beérkező bizonylatok közé. */
export async function portalUploadAction(fd: FormData) {
  return withAudit("portalUploadAction", fd, () => portalUploadActionImpl(fd));
}

async function portalUploadActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user, company } = await requireCompany(cid, { write: true, portal: true, module: "inbox" });
  const back = `/p/${cid}`;
  await runOrRedirect(back, async () => {
    if (!moduleOn(company, "inbox")) throw new Error("Ennél a cégnél a bizonylatgyűjtő ki van kapcsolva.");
    const kind = fd.get("kind") === "statement" ? "statement" : "invoice";
    const note = optStr(fd, "note");
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && (f as File).size > 0);
    if (!files.length) throw new Error("Válassz ki vagy fotózz le legalább egy bizonylatot.");
    let n = 0;
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) throw new Error(`${f.name}: túl nagy (max. ${MAX_MB} MB).`);
      const data = Buffer.from(await f.arrayBuffer()).toString("base64");
      const id = await addDocument(cid, {
        source: "upload", sourceRef: `portal:${user.id}:${Date.now()}:${randomBytes(4).toString("hex")}`, kind,
        filename: f.name || `foto-${new Date().toISOString().slice(0, 10)}.jpg`, mime: f.type || "application/octet-stream", data,
        emailFrom: user.email, emailSubject: note ? `Mobil feltöltés: ${note}` : "Mobil feltöltés", emailDate: new Date().toISOString(),
        uploadedBy: user.id,
      });
      if (id) n++;
    }
    revalidatePath(back);
    revalidatePath(`/c/${cid}/inbox`);
    return `${back}?ok=${encodeURIComponent(n === 1 ? "Feltöltve – köszönjük!" : `${n} bizonylat feltöltve – köszönjük!`)}`;
  });
}
