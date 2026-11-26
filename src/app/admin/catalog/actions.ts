"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { runOrRedirect } from "@/lib/action-utils";
import { importCatalogCsv } from "@/lib/car-catalog";

const BACK = "/admin/catalog";

/** v4.5.3 – Típuskatalógus betöltése az autodata_tipusok.csv-ből (újratölthető: source_id szerint frissít). */
export async function importCatalogAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect(BACK, async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Válaszd ki az autodata_tipusok.csv fájlt.");
    const r = await importCatalogCsv(await file.text());
    revalidatePath(BACK);
    return `${BACK}?ok=${encodeURIComponent(`Betöltve: ${r.makes} márka, ${r.models} modell, ${r.variants} változat${r.skipped ? ` (${r.skipped} sor kihagyva)` : ""}.`)}`;
  });
}
