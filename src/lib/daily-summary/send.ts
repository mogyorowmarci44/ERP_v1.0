/**
 * v3.9.2 – Napi összefoglaló küldése SMTP-n (alapból Gmail alkalmazásjelszóval) és a futás naplózása.
 * Ütemezett futás: naponta egyszer, Budapest szerint 6:45 és 12:00 között az első hívás küld (a GitHub Actions
 * ütemező UTC-ben fut és késhet, ezért egy ablakot nézünk, és a már elküldött napot kihagyjuk).
 */
import "server-only";
import nodemailer from "nodemailer";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { today } from "@/lib/dates";
import { companySnapshot, holdingSnapshot, type CompanySnapshot } from "./data";
import { renderCompanyMail, renderHoldingMail, type Mail, type Variant } from "./render";

export type RunLog = { date: string; at: string; trigger: string; sent: number; failed: number; errors: string[] };
export type DailySummarySettings = { enabled: boolean; holdingEmails: string[]; lastRun: RunLog | null };
const KEY = "dailySummary";
const DEFAULTS: DailySummarySettings = { enabled: true, holdingEmails: [], lastRun: null };

export async function getSummarySettings(): Promise<DailySummarySettings> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return { ...DEFAULTS, ...((r?.value as Partial<DailySummarySettings>) ?? {}) };
}
export async function saveSummarySettings(patch: Partial<DailySummarySettings>) {
  const value = { ...(await getSummarySettings()), ...patch };
  await db.insert(schema.appSettings).values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function deliver(to: string, mail: Mail, attachments: Array<{ filename: string; content: string }> = []) {
  if (!smtpConfigured()) throw new Error("Az e-mail küldés nincs beállítva (SMTP_USER / SMTP_PASS a Render környezeti változói között).");
  const port = Number(process.env.SMTP_PORT || 465);
  const tr = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await tr.sendMail({
    from: process.env.MAIL_FROM || `"mogyorosi.erp" <${process.env.SMTP_USER}>`,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments,
  });
}

/** A tegnapi napló CSV-ben (pénzügyes / teljes változathoz). */
export function journalCsv(s: CompanySnapshot): { filename: string; content: string } {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["Dátum", "Könyvelés", "Összeg (Ft)", "Tartozik", "Követel"].join(";"),
    ...s.finance.entries.map((e) => [s.day, q(e.label), String(Math.round(e.amount)), q(e.debit), q(e.credit)].join(";"))];
  return { filename: `naplo_${s.name.replace(/[^\p{L}\p{N}]+/gu, "_")}_${s.day}.csv`, content: "﻿" + rows.join("\r\n") };
}

/** Budapest szerinti óra:perc (pl. „06:59”). */
export function budapestTime(d = new Date()): string {
  return new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
/** Ütemezett futásnál küldhet-e most (ablak: 06:45–12:00, naponta egyszer). */
export function shouldRunNow(time: string, lastRunDate: string | null, t: string): { ok: boolean; reason?: string } {
  if (lastRunDate === t) return { ok: false, reason: "ma már kiment" };
  if (time < "06:45") return { ok: false, reason: `még korán van (${time})` };
  if (time >= "12:00") return { ok: false, reason: `elmúlt dél (${time}) – a mai összefoglaló kimaradt` };
  return { ok: true };
}

export async function recipientsByCompany() {
  const rows = await db.select().from(schema.summaryRecipients).where(eq(schema.summaryRecipients.active, true)).orderBy(asc(schema.summaryRecipients.companyId));
  const m = new Map<number, typeof rows>();
  for (const r of rows) m.set(r.companyId, [...(m.get(r.companyId) ?? []), r]);
  return m;
}

export function companyMailFor(s: CompanySnapshot, variant: Variant) {
  const mail = renderCompanyMail(s, variant);
  const attachments = variant === "cfo" || variant === "full" ? (s.finance.entries.length ? [journalCsv(s)] : []) : [];
  return { mail, attachments };
}

/** Az összes címzettnek kiküldi a napi összefoglalót. */
export async function runDailySummary(opts: { trigger: "cron" | "manual"; force?: boolean }): Promise<{ skipped?: string; log?: RunLog }> {
  const t = today();
  const st = await getSummarySettings();
  if (opts.trigger === "cron") {
    if (!st.enabled) return { skipped: "kikapcsolva" };
    const w = shouldRunNow(budapestTime(), st.lastRun?.date ?? null, t);
    if (!w.ok && !opts.force) return { skipped: w.reason };
  }
  const errors: string[] = [];
  let sent = 0;
  const cache = new Map<number, CompanySnapshot>();
  const byCompany = await recipientsByCompany();
  for (const [cid, list] of byCompany) {
    let snap: CompanySnapshot;
    try {
      snap = await companySnapshot(cid, t);
      cache.set(cid, snap);
    } catch (e) {
      errors.push(`Cég #${cid}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const r of list) {
      try {
        const { mail, attachments } = companyMailFor(snap, r.variant as Variant);
        await deliver(r.email, mail, attachments);
        sent++;
      } catch (e) {
        errors.push(`${snap.name} → ${r.email}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (st.holdingEmails.length) {
    try {
      const mail = renderHoldingMail(await holdingSnapshot(t, cache));
      for (const to of st.holdingEmails) {
        try {
          await deliver(to, mail);
          sent++;
        } catch (e) {
          errors.push(`Holding → ${to}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      errors.push(`Holding: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const log: RunLog = { date: t, at: new Date().toISOString(), trigger: opts.trigger, sent, failed: errors.length, errors: errors.slice(0, 20) };
  await saveSummarySettings({ lastRun: log });
  return { log };
}

/** Egyetlen e-mail próbaküldése (beállító oldalról). */
export async function sendTestCompany(cid: number, email: string, variant: Variant) {
  const { mail, attachments } = companyMailFor(await companySnapshot(cid), variant);
  await deliver(email, { ...mail, subject: `[Próba] ${mail.subject}` }, attachments);
}
export async function sendTestHolding(email: string) {
  const mail = renderHoldingMail(await holdingSnapshot());
  await deliver(email, { ...mail, subject: `[Próba] ${mail.subject}` });
}
