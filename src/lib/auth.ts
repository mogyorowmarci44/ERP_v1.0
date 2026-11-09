import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, getTableColumns } from "drizzle-orm";
import { db, schema } from "@/db";

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

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
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
  (await cookies()).delete(COOKIE);
}

export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = Number(payload.uid);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
    return u ?? null;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/login");
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
