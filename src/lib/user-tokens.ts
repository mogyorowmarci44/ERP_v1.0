import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { deliver, smtpConfigured } from "@/lib/daily-summary/send";
import { audit } from "@/lib/audit";

/**
 * v6.0.0 – Egyszer használható linkek: jelszó-visszaállítás (1 óra) és meghívó (7 nap).
 * A link csak egyszer jelenik meg / megy ki e-mailben; az adatbázisban csak a SHA-256 hash-e van.
 */
export type TokenPurpose = "reset" | "invite";
export const TOKEN_TTL_MIN: Record<TokenPurpose, number> = { reset: 60, invite: 7 * 24 * 60 };

const { userTokens, users } = schema;
export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Új link; a felhasználó korábbi, azonos célú, fel nem használt linkjei érvénytelenné válnak. */
export async function createUserToken(userId: number, purpose: TokenPurpose, createdBy: number | null = null): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.update(userTokens).set({ usedAt: new Date() })
    .where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt)));
  await db.insert(userTokens).values({
    userId, purpose, tokenHash: hashToken(raw), createdBy,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MIN[purpose] * 60000),
  });
  return raw;
}

/** Érvényes (nem lejárt, nem használt) link felhasználója – felhasználás nélkül (az oldal megjelenítéséhez). */
export async function peekUserToken(raw: string) {
  if (!raw || raw.length < 20) return null;
  const [r] = await db
    .select({ token: userTokens, user: users })
    .from(userTokens)
    .innerJoin(users, eq(users.id, userTokens.userId))
    .where(and(eq(userTokens.tokenHash, hashToken(raw)), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())));
  return r ?? null;
}

/** A link felhasználása (egyszer). Versenyhelyzet ellen feltételes frissítéssel. */
export async function consumeUserToken(raw: string) {
  const r = await peekUserToken(raw);
  if (!r) return null;
  const [done] = await db.update(userTokens).set({ usedAt: new Date() })
    .where(and(eq(userTokens.id, r.token.id), isNull(userTokens.usedAt))).returning({ id: userTokens.id });
  return done ? r : null;
}

/** Az ERP nyilvános címe: APP_URL, különben a kérés fejlécéből. */
export async function appBaseUrl(): Promise<string> {
  const env = process.env.APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return "http://localhost:3000";
  }
}

export async function tokenLink(raw: string, purpose: TokenPurpose) {
  return `${await appBaseUrl()}/login/reset?t=${encodeURIComponent(raw)}${purpose === "invite" ? "&invite=1" : ""}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A link kiküldése e-mailben. Ha a levélküldés nincs beállítva vagy hibázik, false (a hívó megmutatja a linket). */
export async function mailTokenLink(to: string, name: string, link: string, purpose: TokenPurpose, extra?: { inviter?: string; org?: string }): Promise<boolean> {
  if (!smtpConfigured()) return false;
  const invite = purpose === "invite";
  const subject = invite ? `Meghívó a mogyorosi.erp rendszerbe${extra?.org ? ` – ${extra.org}` : ""}` : "Jelszó visszaállítása – mogyorosi.erp";
  const intro = invite
    ? `${extra?.inviter ? `${extra.inviter} meghívott` : "Meghívást kaptál"} a mogyorosi.erp rendszerbe${extra?.org ? ` (${extra.org})` : ""}. A lenti linken állítsd be a jelszavad; a link 7 napig érvényes.`
    : "Jelszó-visszaállítást kértél. A lenti linken adhatsz meg új jelszót; a link 1 óráig érvényes és egyszer használható. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet.";
  const button = invite ? "Fiók aktiválása" : "Új jelszó megadása";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;max-width:560px">
<p>Kedves ${esc(name)}!</p><p>${esc(intro)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${button}</a></p>
<p style="font-size:12px;color:#6b7280">Ha a gomb nem működik, másold a böngészőbe: ${esc(link)}</p>
<p style="font-size:12px;color:#6b7280">mogyorosi.erp · Mogyorosi Holding™</p></div>`;
  const text = `Kedves ${name}!\n\n${intro}\n\n${button}: ${link}\n\nmogyorosi.erp · Mogyorosi Holding™`;
  try {
    await deliver(to, { subject, html, text });
    return true;
  } catch (e) {
    console.error("[user-tokens] levélküldési hiba:", e);
    return false;
  }
}

/** Meghívó link létrehozása és kiküldése; visszaadja a felhasználónak szóló üzenetet. */
export async function sendInvite(
  target: { id: number; email: string; name: string; organizationId: number | null },
  inviter: { id: number; name: string },
  where: string,
): Promise<string> {
  const raw = await createUserToken(target.id, "invite", inviter.id);
  const link = await tokenLink(raw, "invite");
  const sent = await mailTokenLink(target.email, target.name, link, "invite", { inviter: inviter.name, org: where });
  await audit({ action: "invite.create", organizationId: target.organizationId, target: target.email, details: { emailed: sent } });
  return sent
    ? `Meghívó elküldve: ${target.email} (7 napig érvényes).`
    : `A felhasználó létrejött, de a levélküldés nincs beállítva – add át neki ezt a meghívó linket (7 napig érvényes, egyszer használható): ${link}`;
}

