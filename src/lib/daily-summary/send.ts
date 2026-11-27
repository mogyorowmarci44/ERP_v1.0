/**
 * v3.9.2 – Napi összefoglaló küldése SMTP-n (alapból Gmail alkalmazásjelszóval) és a futás naplózása.
 * Ütemezett futás: naponta egyszer, Budapest szerint 6:45 és 12:00 között az első hívás küld (a GitHub Actions
 * ütemező UTC-ben fut és késhet, ezért egy ablakot nézünk, és a már elküldött napot kihagyjuk).
 */
import "server-only";
import nodemailer from "nodemailer";
import { asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { today } from "@/lib/dates";
import { companySnapshot, holdingCompanies, holdingSnapshot, type CompanySnapshot } from "./data";
import { renderCompanyMail, renderHoldingMail, type Mail, type Variant } from "./render";
import { deliverApi, mailApiConfigured } from "@/lib/mail-api";

export type RunLog = { date: string; at: string; trigger: string; sent: number; failed: number; errors: string[] };
/**
 * enabled = fő kapcsoló (kikapcsolva semmi nem megy ki, a kézi „Küldés most” sem);
 * holdingEnabled = a holding e-mail; disabledCompanies = azok a cégek, amelyek jelentése szünetel.
 */
export type DailySummarySettings = { enabled: boolean; holdingEnabled: boolean; disabledCompanies: number[]; holdingEmails: string[]; lastRun: RunLog | null };
const KEY = "dailySummary";
const DEFAULTS: DailySummarySettings = { enabled: true, holdingEnabled: true, disabledCompanies: [], holdingEmails: [], lastRun: null };

/** Egy cég jelentése kimegy-e (fő kapcsoló és a cég kapcsolója). */
export const companyEnabled = (st: DailySummarySettings, cid: number) => st.enabled && !st.disabledCompanies.includes(cid);

/** Kapcsolók állítása (fő / holding / cég). */
export async function setSummaryToggle(what: { all?: boolean; holding?: boolean; company?: { id: number; on: boolean } }) {
  const st = await getSummarySettings();
  const patch: Partial<DailySummarySettings> = {};
  if (what.all !== undefined) patch.enabled = what.all;
  if (what.holding !== undefined) patch.holdingEnabled = what.holding;
  if (what.company) {
    const rest = st.disabledCompanies.filter((x) => x !== what.company!.id);
    patch.disabledCompanies = what.company.on ? rest : [...rest, what.company.id];
  }
  await saveSummarySettings(patch);
}

export async function getSummarySettings(): Promise<DailySummarySettings> {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return { ...DEFAULTS, ...((r?.value as Partial<DailySummarySettings>) ?? {}) };
}
export async function saveSummarySettings(patch: Partial<DailySummarySettings>) {
  const value = { ...(await getSummarySettings()), ...patch };
  await db.insert(schema.appSettings).values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

/** v3.9.8 – HTTPS-es levéltovábbító (Google Apps Script, a saját Gmail-fiókból): a Render ingyenes csomagja az SMTP-portokat tiltja. */
export function relayConfigured(): boolean {
  return !!(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET);
}

/** Be van-e állítva valamilyen küldési mód (HTTPS-továbbító vagy SMTP). */
export function smtpConfigured(): boolean {
  return mailApiConfigured() || relayConfigured() || !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

type Attachment = { filename: string; content: string };

/** v3.9.8 – Küldés a Google Apps Script továbbítón át (HTTPS, 443-as port). */
async function deliverRelay(to: string, mail: Mail, attachments: Attachment[]) {
  const res = await fetch(process.env.MAIL_RELAY_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      secret: process.env.MAIL_RELAY_SECRET, to, subject: mail.subject, html: mail.html, text: mail.text, name: process.env.MAIL_FROM_NAME || "mogyorosi.erp",
      attachments: attachments.map((a) => ({ filename: a.filename, mimeType: "text/csv", base64: Buffer.from(a.content, "utf8").toString("base64") })),
    }),
  });
  const body = await res.text();
  let j: { ok?: boolean; error?: string } = {};
  try { j = JSON.parse(body); } catch { /* nem JSON – lent kezelve */ }
  if (!res.ok || !j.ok) throw new Error(`A levéltovábbító hibát adott: ${j.error ?? `HTTP ${res.status} ${body.slice(0, 160)}`}`);
}

export async function deliver(to: string, mail: Mail, attachments: Attachment[] = []) {
  // v6.7.0 – elsőként a saját domaines tranzakciós szolgáltató (Brevo / Resend), utána a Gmail-továbbító, végül SMTP
  if (mailApiConfigured()) return deliverApi(to, mail, attachments.map((a) => ({ ...a, mime: "text/csv" })));
  if (relayConfigured()) return deliverRelay(to, mail, attachments);
  if (!smtpConfigured()) throw new Error("Az e-mail küldés nincs beállítva (MAIL_RELAY_URL / MAIL_RELAY_SECRET, vagy SMTP_USER / SMTP_PASS a Render környezeti változói között).");
  const port = Number(process.env.SMTP_PORT || 465);
  const tr = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  try {
    await tr.sendMail({
      from: process.env.MAIL_FROM || `"mogyorosi.erp" <${process.env.SMTP_USER}>`,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(m))
      throw new Error(`Az SMTP-kapcsolat nem jött létre (${m}). A Render ingyenes csomagja 2025 szeptembere óta tiltja a kimenő SMTP-t (25 / 465 / 587) – állítsd be a Gmail-továbbítót (MAIL_RELAY_URL, MAIL_RELAY_SECRET; lásd scripts/gmail-relay.gs).`);
    throw e;
  }
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
  if (!st.enabled) return { skipped: "a napi összefoglaló ki van kapcsolva" };
  if (opts.trigger === "cron") {
    // v3.9.8: csak az a nap számít elvégzettnek, amelyen legalább egy levél ki is ment
    const w = shouldRunNow(budapestTime(), st.lastRun && st.lastRun.sent > 0 ? st.lastRun.date : null, t);
    if (!w.ok && !opts.force) return { skipped: w.reason };
  }
  const errors: string[] = [];
  let sent = 0;
  const cache = new Map<number, CompanySnapshot>();
  const byCompany = await recipientsByCompany();
  // v6.0.0 – archivált cég jelentése nem megy ki
  const archived = new Set((await db.select({ id: schema.companies.id }).from(schema.companies).where(isNotNull(schema.companies.archivedAt))).map((r) => r.id));
  for (const [cid, list] of byCompany) {
    if (!companyEnabled(st, cid) || archived.has(cid)) continue;
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
  if (st.holdingEnabled && st.holdingEmails.length) {
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
  if (!sent && !errors.length) errors.push("Nincs aktív címzett: minden bekapcsolt cégnél üres a címzettlista (vagy a cég jelentése szünetel), és nincs holding-címzett.");
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

/** v3.9.8 – Figyelmeztetések a beállító oldalakhoz: miért nem menne ki levél. */
export async function summaryWarnings(): Promise<string[]> {
  const [st, byCompany, cos] = await Promise.all([getSummarySettings(), recipientsByCompany(), db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(holdingCompanies())]);
  const w: string[] = [];
  if (!st.enabled) return ["A napi összefoglaló fő kapcsolója ki van kapcsolva – semmi nem megy ki."];
  if (!smtpConfigured()) w.push("Nincs beállítva küldési mód (MAIL_RELAY_URL / MAIL_RELAY_SECRET a Renderen).");
  else if (!relayConfigured()) w.push("SMTP-vel küld: a Render ingyenes csomagja tiltja a kimenő SMTP-t, ezért connection timeout lesz. Állítsd be a Gmail-továbbítót (MAIL_RELAY_URL, MAIL_RELAY_SECRET).");
  for (const c of cos) {
    const n = byCompany.get(c.id)?.length ?? 0;
    if (n && !companyEnabled(st, c.id)) w.push(`${c.name}: ${n} címzett van, de a cég jelentése szünetel – nekik nem megy ki.`);
  }
  const live = cos.filter((c) => companyEnabled(st, c.id) && (byCompany.get(c.id)?.length ?? 0) > 0).length;
  if (!live && !(st.holdingEnabled && st.holdingEmails.length)) w.push("Jelenleg egyetlen levél sem menne ki: nincs bekapcsolt cég címzettel, és nincs holding-címzett.");
  return w;
}
