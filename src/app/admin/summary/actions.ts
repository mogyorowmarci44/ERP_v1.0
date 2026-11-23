"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { runDailySummary, saveSummarySettings, sendTestHolding } from "@/lib/daily-summary/send";

const BACK = "/admin/summary";
const ok = (m: string) => `${BACK}?ok=${encodeURIComponent(m)}`;

export async function saveHoldingAction(fd: FormData) {
  await requireAdmin();
  await runOrRedirect(BACK, async () => {
    const emails = str(fd, "emails").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) throw new Error(`Hibás e-mail cím: ${bad.join(", ")}`);
    await saveSummarySettings({ holdingEmails: [...new Set(emails)], enabled: fd.get("enabled") === "on" });
    revalidatePath(BACK);
    return ok("Mentve.");
  });
}

export async function testHoldingAction(fd: FormData) {
  await requireAdmin();
  await runOrRedirect(BACK, async () => {
    const to = str(fd, "to");
    if (!to) throw new Error("Adj meg címet.");
    await sendTestHolding(to);
    return ok(`Próba holding e-mail elküldve: ${to}`);
  });
}

export async function runNowAction() {
  await requireAdmin();
  await runOrRedirect(BACK, async () => {
    const r = await runDailySummary({ trigger: "manual" });
    const l = r.log!;
    return l.failed ? `${BACK}?error=${encodeURIComponent(`${l.sent} elküldve, ${l.failed} hiba: ${l.errors[0]}`)}` : ok(`${l.sent} e-mail elküldve mindenkinek.`);
  });
}
