"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";

export async function saveValuationParamsAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/value`, async () => {
    const multiple = parseNumber(fd.get("multiple"));
    const rate = parseNumber(fd.get("discountRate")) / 100;
    if (!(multiple > 0 && multiple <= 20)) throw new Error("A szorzó 0 és 20 között legyen.");
    if (!(rate >= 0 && rate <= 1)) throw new Error("A diszkontráta 0 és 100% között legyen.");
    const [cur] = await db.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, cid));
    await db.update(schema.companies).set({ settings: { ...cur.settings, valuationMultiple: multiple, valuationDiscountRate: rate } }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/value?ok=${encodeURIComponent("Paraméterek mentve.")}`;
  });
}
