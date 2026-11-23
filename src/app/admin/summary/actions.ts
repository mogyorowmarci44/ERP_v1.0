"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { runDailySummary, saveSummarySettings, sendTestHolding, setSummaryToggle } from "@/lib/daily-summary/send";

const BACK = "/admin/summary";
const ok = (m: string) => `${BACK}?ok=${encodeURIComponent(m)}`;

export async function saveHoldingAction(fd: FormData) {
  await requireAdmin();
  await runOrRedirect(BACK, async () => {
    const emails = str(fd, "emails").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) throw new Error(`Hibás e-mail cím: ${bad.join(", ")}`);
    await saveSummarySettings({ holdingEmails: [...new Set(emails)] });
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
    if (!r.log) throw new Error(`Nem ment ki: ${r.skipped}.`);
    const l = r.log;
    return l.failed ? `${BACK}?error=${encodeURIComponent(`${l.sent} elküldve, ${l.failed} hiba: ${l.errors[0]}`)}` : ok(`${l.sent} e-mail elküldve mindenkinek.`);
  });
}

/** v3.9.3 – Be / ki kapcsolók: what = all | holding | company:<id>, on = 1 | 0. */
export async function toggleSummaryAction(fd: FormData) {
  await requireAdmin();
  await runOrRedirect(BACK, async () => {
    const what = str(fd, "what"), on = fd.get("on") === "1";
    if (what === "all") await setSummaryToggle({ all: on });
    else if (what === "holding") await setSummaryToggle({ holding: on });
    else if (what.startsWith("company:")) await setSummaryToggle({ company: { id: Number(what.slice(8)), on } });
    revalidatePath(BACK);
    return ok(what === "all" ? (on ? "Napi összefoglaló bekapcsolva." : "Napi összefoglaló kikapcsolva – semmi nem megy ki.") : on ? "Bekapcsolva." : "Kikapcsolva.");
  });
}
