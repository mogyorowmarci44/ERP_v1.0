import "server-only";
import { and, count, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { today } from "@/lib/dates";
import { nextVatDeadline } from "@/lib/vat-deadline";
import { unclosedVatPeriods } from "@/lib/vat-closing";
import { draftCounts } from "@/lib/drafts";
import { openItems } from "@/lib/reports";
import { moduleOn } from "@/lib/modules";
import { isPrivate } from "@/lib/entity";
import { nextPayrollDeadline, lastClosedMonth } from "@/lib/office-calc";

/**
 * v6.9.0 – Könyvelőirodai nézet: a felhasználó összes (nem archivált) cégének állapota egy helyen –
 * határidők, teendők, ÁFA-zárás, könyvelés frissessége.
 */
const INBOX_TODO = ["review", "error", "new", "extracted"];

export type Pulse = {
  id: number; name: string; role: string; private: boolean;
  vatDue: string | null; vatOpen: number; payrollDue: string | null;
  inbox: number; drafts: number; overdueRecv: number;
  lastEntry: string | null; lockedThrough: string | null;
  todo: number;
};

export async function officeOverview(userId: number): Promise<Pulse[]> {
  const t = today();
  const cos = await db
    .select({ c: schema.companies, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(and(eq(schema.memberships.userId, userId), isNull(schema.companies.archivedAt), ne(schema.memberships.role, "uploader")));
  if (!cos.length) return [];
  const ids = cos.map((x) => x.c.id);
  const [inbox, last, locks, emps] = await Promise.all([
    db.select({ cid: schema.inboxDocuments.companyId, n: count() }).from(schema.inboxDocuments)
      .where(and(inArray(schema.inboxDocuments.companyId, ids), inArray(schema.inboxDocuments.status, INBOX_TODO))).groupBy(schema.inboxDocuments.companyId),
    db.select({ cid: schema.journalEntries.companyId, d: max(schema.journalEntries.date) }).from(schema.journalEntries)
      .where(inArray(schema.journalEntries.companyId, ids)).groupBy(schema.journalEntries.companyId),
    db.select({ cid: schema.periodLocks.companyId, year: schema.periodLocks.year, month: schema.periodLocks.month }).from(schema.periodLocks)
      .where(inArray(schema.periodLocks.companyId, ids)),
    db.select({ cid: schema.employees.companyId, n: count() }).from(schema.employees).where(inArray(schema.employees.companyId, ids)).groupBy(schema.employees.companyId),
  ]);
  const by = <T extends { cid: number }>(rows: T[]) => new Map(rows.map((r) => [r.cid, r]));
  const inboxM = by(inbox), lastM = by(last), empM = by(emps);
  return Promise.all(
    cos.map(async ({ c, role }): Promise<Pulse> => {
      const priv = isPrivate(c);
      const [vatOpen, drafts, recv] = await Promise.all([priv ? Promise.resolve([]) : unclosedVatPeriods(c.id), draftCounts(c.id), openItems(c.id, "out")]);
      const payrollOn = !priv && moduleOn(c, "payroll") && Number(empM.get(c.id)?.n ?? 0) > 0;
      const p: Pulse = {
        id: c.id, name: c.name, role, private: priv,
        vatDue: priv || !c.taxNumber ? null : nextVatDeadline(c.vatPeriod, t),
        vatOpen: vatOpen.length,
        payrollDue: payrollOn ? nextPayrollDeadline(t) : null,
        inbox: moduleOn(c, "inbox") ? Number(inboxM.get(c.id)?.n ?? 0) : 0,
        drafts: drafts.total,
        overdueRecv: recv.filter((r) => r.dueDate && r.dueDate < t).length,
        lastEntry: lastM.get(c.id)?.d ?? null,
        lockedThrough: lastClosedMonth(locks.filter((l) => l.cid === c.id)),
        todo: 0,
      };
      p.todo = p.vatOpen + (p.inbox ? 1 : 0) + (p.drafts ? 1 : 0);
      return p;
    }),
  );
}
