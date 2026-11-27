"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { audit } from "@/lib/audit";
import { checkoutUrl, portalUrl } from "@/lib/billing";

/** v6.8.0 – Előfizetés indítása (Stripe Checkout). */
export async function startCheckoutAction(fd: FormData) {
  const admin = await requireAdmin();
  let url = "";
  await runOrRedirect("/admin/billing", async () => {
    url = await checkoutUrl(admin.organizationId, Number(fd.get("planId")), admin.email);
    await audit({ action: "billing.checkout", details: { planId: Number(fd.get("planId")) } });
  });
  redirect(url);
}

/** Stripe ügyfélportál: kártya, számlák, csomagváltás, lemondás. */
export async function openPortalAction() {
  const admin = await requireAdmin();
  let url = "";
  await runOrRedirect("/admin/billing", async () => {
    url = await portalUrl(admin.organizationId);
  });
  redirect(url);
}

/** Számlázási e-mail cím (a Stripe-nyugtákhoz). */
export async function saveBillingEmailAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin/billing", async () => {
    const email = str(fd, "billingEmail").toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Érvénytelen e-mail cím.");
    await db.update(schema.organizations).set({ billingEmail: email || null }).where(eq(schema.organizations.id, admin.organizationId));
    return "/admin/billing?ok=" + encodeURIComponent("Mentve.");
  });
}
