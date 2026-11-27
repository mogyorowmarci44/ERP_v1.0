/** v7.3.0 – Fizetési emlékeztető levél (tiszta függvény, tesztelhető). Udvarias, tárgyszerű hangnem; a védjegy a láblécben. */
import type { Mail } from "@/lib/daily-summary/render";

export type ReminderItem = { invoiceNumber: string; issueDate: string; dueDate: string | null; openFx: number; currency: string };
export type ReminderInput = { companyName: string; partnerName: string; items: ReminderItem[]; bankAccount?: string | null; contactName?: string | null; contactEmail?: string | null; today: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const d = (s: string | null) => (s ? `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}.` : "–");
export const money = (n: number, cur: string) =>
  cur === "HUF" ? `${Math.round(n).toLocaleString("hu-HU")} Ft` : `${n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
export const lateDays = (due: string | null, t: string) => (due && due < t ? Math.round((Date.parse(t) - Date.parse(due)) / 86_400_000) : 0);

export function renderReminder(x: ReminderInput): Mail {
  if (!x.items.length) throw new Error("Nincs lejárt tétel.");
  const totals = new Map<string, number>();
  for (const i of x.items) totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.openFx);
  const totalTxt = [...totals].map(([c, n]) => money(n, c)).join(" + ");
  const one = x.items.length === 1;
  const subject = one ? `Fizetési emlékeztető – ${x.items[0].invoiceNumber} (${x.companyName})` : `Fizetési emlékeztető – ${x.items.length} számla (${x.companyName})`;
  const rowsTxt = x.items.map((i) => `- ${i.invoiceNumber}: kelte ${d(i.issueDate)}, esedékes ${d(i.dueDate)}, nyitott ${money(i.openFx, i.currency)}${lateDays(i.dueDate, x.today) ? ` (${lateDays(i.dueDate, x.today)} napja lejárt)` : ""}`).join("\n");
  const pay = x.bankAccount ? `Kérjük, az összeget a ${x.bankAccount} bankszámlaszámra utalja, a közleményben a számla sorszámával.` : "Kérjük, az összeget a számlán szereplő módon egyenlítse ki.";
  const sign = [x.contactName, x.companyName, x.contactEmail].filter(Boolean).join("\n");
  const text = `Tisztelt ${x.partnerName}!

Nyilvántartásunk szerint ${one ? "az alábbi számla" : "az alábbi számlák"} kiegyenlítése még nem érkezett meg hozzánk:

${rowsTxt}

Összesen: ${totalTxt}

${pay}
Ha időközben már rendezte, kérjük, tekintse levelünket tárgytalannak – köszönjük! Kérdés esetén válaszoljon erre a levélre${x.contactEmail ? ` vagy írjon a ${x.contactEmail} címre` : ""}.

Üdvözlettel:
${sign}

—
Mogyorosi Holding™ · mogyorosi.erp`;
  const tr = x.items.map((i) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.invoiceNumber)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${d(i.issueDate)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${d(i.dueDate)}${lateDays(i.dueDate, x.today) ? ` <span style="color:#b42318">(${lateDays(i.dueDate, x.today)} nap)</span>` : ""}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right"><strong>${esc(money(i.openFx, i.currency))}</strong></td></tr>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1d2433;max-width:640px">
<p>Tisztelt ${esc(x.partnerName)}!</p>
<p>Nyilvántartásunk szerint ${one ? "az alábbi számla" : "az alábbi számlák"} kiegyenlítése még nem érkezett meg hozzánk:</p>
<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#f4f6f9"><th style="padding:6px 10px;text-align:left">Számla</th><th style="padding:6px 10px;text-align:left">Kelte</th><th style="padding:6px 10px;text-align:left">Esedékes</th><th style="padding:6px 10px;text-align:right">Nyitott</th></tr></thead><tbody>${tr}</tbody>
<tfoot><tr><td colspan="3" style="padding:8px 10px;text-align:right">Összesen:</td><td style="padding:8px 10px;text-align:right"><strong>${esc(totalTxt)}</strong></td></tr></tfoot></table>
<p>${esc(pay)}</p>
<p>Ha időközben már rendezte, kérjük, tekintse levelünket tárgytalannak – köszönjük! Kérdés esetén válaszoljon erre a levélre${x.contactEmail ? ` vagy írjon a <a href="mailto:${esc(x.contactEmail)}">${esc(x.contactEmail)}</a> címre` : ""}.</p>
<p>Üdvözlettel:<br>${sign.split("\n").map(esc).join("<br>")}</p>
<p style="color:#8a94a6;font-size:11px;border-top:1px solid #eee;padding-top:8px">Mogyorosi Holding™ · mogyorosi.erp</p></div>`;
  return { subject, html, text };
}
