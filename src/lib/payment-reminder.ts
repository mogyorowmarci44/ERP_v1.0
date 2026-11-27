/** v7.3.0 – Fizetési emlékeztető küldése egy partner lejárt vevőszámláiról (gombbal, a Nyitott tételek oldalról). */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { openItems } from "@/lib/reports";
import { today } from "@/lib/dates";
import { deliver } from "@/lib/daily-summary/send";
import { renderReminder } from "@/lib/payment-reminder-calc";

export const REMINDER_GAP_DAYS = 3;

export async function lastReminders(companyId: number, invoiceIds: number[]) {
  if (!invoiceIds.length) return new Map<number, Date>();
  const rows = await db.select({ invoiceId: schema.paymentReminders.invoiceId, at: schema.paymentReminders.sentAt }).from(schema.paymentReminders)
    .where(and(eq(schema.paymentReminders.companyId, companyId), inArray(schema.paymentReminders.invoiceId, invoiceIds))).orderBy(desc(schema.paymentReminders.sentAt));
  const m = new Map<number, Date>();
  for (const r of rows) if (!m.has(r.invoiceId)) m.set(r.invoiceId, r.at);
  return m;
}

export async function sendPaymentReminder(companyId: number, partnerId: number, user: { id: number; name: string; email: string }, opts: { bankAccount?: string | null; force?: boolean } = {}) {
  const t = today();
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const [partner] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, companyId)));
  if (!partner) throw new Error("A partner nem található.");
  const to = (partner.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`${partner.name}: nincs (érvényes) e-mail cím – a Partnerek oldalon add meg.`);
  const items = (await openItems(companyId, "out")).filter((o) => o.partnerId === partnerId && o.dueDate && o.dueDate < t && o.openFx > 0);
  if (!items.length) throw new Error(`${partner.name}: nincs lejárt nyitott számla.`);
  const last = await lastReminders(companyId, items.map((i) => i.id));
  const recent = items.filter((i) => { const l = last.get(i.id); return l && Date.now() - l.getTime() < REMINDER_GAP_DAYS * 86_400_000; });
  if (recent.length && !opts.force) throw new Error(`${partner.name}: ${REMINDER_GAP_DAYS} napon belül már ment emlékeztető (${recent.map((r) => r.invoiceNumber).join(", ")}).`);
  const mail = renderReminder({
    companyName: company.name, partnerName: partner.name, today: t, bankAccount: opts.bankAccount ?? null, contactName: user.name, contactEmail: user.email,
    items: items.map((i) => ({ invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, dueDate: i.dueDate, openFx: Number(i.openFx), currency: i.currency })),
  });
  await deliver(to, mail);
  await db.insert(schema.paymentReminders).values(items.map((i) => ({ companyId, invoiceId: i.id, sentTo: to, userId: user.id })));
  return { to, count: items.length, partner: partner.name };
}
