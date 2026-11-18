import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, getTableColumns } from "drizzle-orm";
import { db, schema } from "@/db";
import { mfaRequired } from "@/lib/app-settings";

const COOKIE = "mmerp_session";
const MAX_AGE = 60 * 60 * 12; // 12 óra

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET hiányzik vagy túl rövid (min. 32 karakter)");
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

type SessionUser = { id: number; sessionVersion: number };

/** Teljes munkamenet. `method`: "totp" = jelszó + 2FA, "none" = csak jelszó (amikor az admin kikapcsolta a kötelező 2FA-t). */
export async function createSession(u: SessionUser, method: "totp" | "none" = "totp") {
  const token = await new SignJWT({ uid: u.id, tv: u.sessionVersion, mfa: method })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete(MFA_COOKIE);
}

/** Csak a 2FA-n átjutott, érvényes verziójú munkamenet számít bejelentkezettnek. */
export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    // 2FA-val szerzett munkamenet mindig érvényes; csak jelszavas csak akkor, ha a 2FA nincs kötelezővé téve
    const viaTotp = payload.mfa === true || payload.mfa === "totp";
    if (!viaTotp && !(payload.mfa === "none" && !(await mfaRequired()))) return null;
    const uid = Number(payload.uid);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
    if (!u || Number(payload.tv) !== u.sessionVersion) return null;
    return u;
  } catch {
    return null;
  }
}

// --- Kétlépcsős azonosítás: köztes állapot a jelszó és a kód között ----------------------------

const MFA_COOKIE = "mmerp_mfa";
const MFA_MAX_AGE = 60 * 10; // 10 perc a kód megadására / a 2FA beállítására

export type PendingMfa =
  | { stage: "verify" }
  /** Első beállítás: a titkos kulcs és a tartalékkódok a megerősítésig csak az aláírt, httpOnly sütiben élnek. */
  | { stage: "setup"; secret: string; codes: string[] };

/** Jelszó után: a 2FA lépés elindítása. Visszaadja, hová kell irányítani. */
export async function startMfa(u: SessionUser & { totpEnabledAt: Date | null; email: string }) {
  let data: PendingMfa;
  if (u.totpEnabledAt) data = { stage: "verify" };
  else {
    const { generateSecret, generateRecoveryCodes } = await import("@/lib/totp");
    data = { stage: "setup", secret: generateSecret(), codes: generateRecoveryCodes() };
  }
  const token = await new SignJWT({ uid: u.id, tv: u.sessionVersion, ...data })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MFA_MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(MFA_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MFA_MAX_AGE,
  });
  return data.stage === "verify" ? "/login/2fa" : "/login/2fa/setup";
}

/** A félig (csak jelszóval) bejelentkezett felhasználó és a köztes állapot. */
export async function getPendingMfa() {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, Number(payload.uid)));
    if (!u || Number(payload.tv) !== u.sessionVersion) return null;
    const pending: PendingMfa =
      payload.stage === "setup" ? { stage: "setup", secret: String(payload.secret), codes: (payload.codes as string[]) ?? [] } : { stage: "verify" };
    return { user: u, pending };
  } catch {
    return null;
  }
}

export async function clearPendingMfa() {
  (await cookies()).delete(MFA_COOKIE);
}

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Csak rendszeradminisztrátor (users.is_admin) számára. */
export async function requireAdmin() {
  const u = await requireUser();
  if (!u.isAdmin) redirect("/");
  return u;
}

/** Ellenőrzi, hogy a felhasználó tagja-e a cégnek; visszaadja a céget és a szerepkört. */
export async function requireCompany(companyId: number, opts: { write?: boolean } = {}) {
  const user = await requireUser();
  // A logó (base64) nélkül – azt a /api/logo útvonal szolgálja ki
  const { logoData: _omit, ...companyCols } = getTableColumns(schema.companies);
  void _omit;
  const [row] = await db
    .select({ company: companyCols, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.companyId, companyId)));
  if (!row) redirect("/");
  if (opts.write && row.role === "viewer") throw new Error("Nincs írási jogosultságod ehhez a céghez.");
  return { user, company: row.company, role: row.role };
}

/** Tagság ellenőrzése átirányítás nélkül (API útvonalakhoz). */
export async function isMember(userId: number, companyId: number) {
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, companyId)));
  return m ?? null;
}
