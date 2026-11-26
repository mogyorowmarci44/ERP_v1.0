"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str, intOrNull } from "@/lib/action-utils";
import { sendTestCompany, setSummaryToggle } from "@/lib/daily-summary/send";
import type { Variant } from "@/lib/daily-summary/render";
import { withAudit } from "@/lib/audit";

const VARIANTS: Variant[] = ["ceo", "cfo", "full"];
const variantOf = (v: string): Variant => (VARIANTS.includes(v as Variant) ? (v as Variant) : "ceo");
const back = (cid: number) => `/c/${cid}/summary`;
const okTo = (cid: number, msg: string) => `${back(cid)}?ok=${encodeURIComponent(msg)}`;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function addRecipientAction(fd: FormData) {
  return withAudit("addRecipientAction", fd, () => addRecipientActionImpl(fd));
}

async function addRecipientActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const email = str(fd, "email").toLowerCase();
    const name = str(fd, "name");
    if (!name) throw new Error("A név kötelező.");
    if (!isEmail(email)) throw new Error("Hibás e-mail cím.");
    await db.insert(schema.summaryRecipients).values({ companyId: cid, name, email, variant: variantOf(str(fd, "variant")) });
    revalidatePath(back(cid));
    return okTo(cid, `${name} hozzáadva – holnap reggel 6:59-kor kapja az elsőt.`);
  });
}

export async function updateRecipientAction(fd: FormData) {
  return withAudit("updateRecipientAction", fd, () => updateRecipientActionImpl(fd));
}

async function updateRecipientActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const id = intOrNull(fd, "id");
    if (!id) throw new Error("Hiányzó címzett.");
    const where = and(eq(schema.summaryRecipients.id, id), eq(schema.summaryRecipients.companyId, cid));
    if (fd.get("op") === "delete") {
      await db.delete(schema.summaryRecipients).where(where);
      return okTo(cid, "Címzett törölve.");
    }
    if (fd.get("op") === "toggle") {
      const [r] = await db.select().from(schema.summaryRecipients).where(where);
      if (r) await db.update(schema.summaryRecipients).set({ active: !r.active }).where(where);
      return okTo(cid, r?.active ? "Szüneteltetve." : "Újra kapja.");
    }
    await db.update(schema.summaryRecipients).set({ variant: variantOf(str(fd, "variant")) }).where(where);
    return okTo(cid, "Változat mentve.");
  });
}

export async function testRecipientAction(fd: FormData) {
  return withAudit("testRecipientAction", fd, () => testRecipientActionImpl(fd));
}

async function testRecipientActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const id = intOrNull(fd, "id");
    const [r] = await db.select().from(schema.summaryRecipients).where(and(eq(schema.summaryRecipients.id, id ?? 0), eq(schema.summaryRecipients.companyId, cid)));
    if (!r) throw new Error("Nincs ilyen címzett.");
    await sendTestCompany(cid, r.email, variantOf(r.variant));
    return okTo(cid, `Próba e-mail elküldve: ${r.email}`);
  });
}

/** v3.9.3 – A cég napi összefoglalójának be / ki kapcsolása. */
export async function toggleCompanySummaryAction(fd: FormData) {
  return withAudit("toggleCompanySummaryAction", fd, () => toggleCompanySummaryActionImpl(fd));
}

async function toggleCompanySummaryActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const on = fd.get("on") === "1";
    await setSummaryToggle({ company: { id: cid, on } });
    revalidatePath(back(cid));
    return okTo(cid, on ? "A cég napi összefoglalója bekapcsolva." : "A cég napi összefoglalója kikapcsolva – a címzettek megmaradnak.");
  });
}

/** v3.9.4 – A napi összefoglalóból kihagyott gépkocsik (pl. szándékosan készleten tartott autó). */
export async function saveSummaryExcludeAction(fd: FormData) {
  return withAudit("saveSummaryExcludeAction", fd, () => saveSummaryExcludeActionImpl(fd));
}

async function saveSummaryExcludeActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const ids = fd.getAll("exclude").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const [c] = await db.select({ s: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, cid));
    await db.update(schema.companies).set({ settings: { ...c.s, summaryExcludeVehicles: ids } }).where(eq(schema.companies.id, cid));
    revalidatePath(back(cid));
    return okTo(cid, ids.length ? `${ids.length} autó kihagyva az összefoglalóból.` : "Minden készleten lévő autó szerepel az összefoglalóban.");
  });
}
