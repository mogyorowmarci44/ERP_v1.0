"use server";
import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect } from "@/lib/action-utils";
import { recomputeVatClosings } from "@/lib/vat-closing";
import { mergeAllDuplicates } from "@/lib/partner-merge";
import { autoLinkManualSettlements } from "@/lib/matching";
import { withAudit } from "@/lib/audit";

/** v3.9.6 – Az Egyezőség oldal javító gombjai. */
export async function consistencyFixAction(fd: FormData) {
  return withAudit("consistencyFixAction", fd, () => consistencyFixActionImpl(fd));
}

async function consistencyFixActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/reports/consistency`;
  await runOrRedirect(back, async () => {
    const fix = String(fd.get("fix"));
    let msg = "";
    if (fix === "recompute_vat") { const r = await recomputeVatClosings(cid, user.id); msg = `ÁFA-zárások újraszámolva (${r.changed} zárótétel módosult).`; }
    else if (fix === "merge_partners") { const r = await mergeAllDuplicates(cid); msg = r.length ? `Összevonva: ${r.join("; ")}.` : "Nem volt összevonandó partner."; }
    else if (fix === "link_manual") { const r = await autoLinkManualSettlements(cid); msg = r.length ? `Párosítva: ${r.join("; ")}.` : "Nem találtam egyértelműen párosítható kézi tételt – a számla oldalán a Párosítással rendezd."; }
    else throw new Error("Ismeretlen javítás.");
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}?ok=${encodeURIComponent(msg)}`;
  });
}
