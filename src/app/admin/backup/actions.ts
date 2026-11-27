"use server";

import { requireAdmin } from "@/lib/auth";
import { runOrRedirect } from "@/lib/action-utils";
import { audit } from "@/lib/audit";

/** v7.2.0 – „Mentés most”: az ügyfélfiók összes cégének teljes mentése a fájltárolóba. */
export async function cloudBackupAction() {
  const me = await requireAdmin();
  await runOrRedirect("/admin/backup", async () => {
    if (!me.organizationId) throw new Error("Nincs ügyfélfiók.");
    const { cloudBackupAll, KEEP } = await import("@/lib/cloud-backup");
    const r = await cloudBackupAll(me.organizationId);
    await audit({ action: "backup.cloud", organizationId: me.organizationId, details: { companies: r.companies, bytes: r.bytes, pruned: r.pruned, errors: r.errors.length } });
    if (!r.companies && r.errors.length) throw new Error(r.errors.join(" | "));
    const msg = `${r.companies} cég mentve a tárolóba (${(r.bytes / 1024 / 1024).toFixed(1)} MB). Cégenként a legutóbbi ${KEEP} mentés marad meg.${r.errors.length ? ` Hiba: ${r.errors.join(" | ")}` : ""}`;
    return `/admin/backup?ok=${encodeURIComponent(msg)}#tarolo`;
  });
}
