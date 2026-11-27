/**
 * v7.6.0 – Önkiszolgáló adatkérés és -törlés (GDPR 15., 17., 20. cikk).
 *  - exportUserData: a felhasználó saját személyes adatai géppel olvasható formában (JSON).
 *  - deleteOwnAccount: a fiók törlése álnevesítéssel – a könyvelési tételek (amelyeket a számviteli törvény szerint
 *    8 évig meg kell őrizni) megmaradnak, de a személy többé nem azonosítható belőlük (név, e-mail, jelszó, 2FA törölve).
 *  - closeOrganization: az ügyfélfiók megszüntetése, ha már nincs benne cég (a cégek archiválása + végleges törlése után).
 * A cégek könyvelési adatai a cégé (az ügyfélé), azokat a teljes mentés viszi ki – lásd Admin › Mentés.
 */
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword } from "@/lib/auth";

export const DELETED_DOMAIN = "torolt.invalid";
export const anonEmail = (id: number) => `torolt-${id}@${DELETED_DOMAIN}`;

export async function exportUserData(userId: number) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new Error("A felhasználó nem található.");
  const [org] = u.organizationId ? await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, u.organizationId)) : [];
  const memberships = await db.select({ companyId: schema.companies.id, company: schema.companies.name, role: schema.memberships.role, hiddenModules: schema.memberships.hiddenModules })
    .from(schema.memberships).innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId)).where(eq(schema.memberships.userId, userId));
  const summaries = await db.select({ companyId: schema.summaryRecipients.companyId, email: schema.summaryRecipients.email }).from(schema.summaryRecipients).where(eq(schema.summaryRecipients.email, u.email));
  const activity = await db.select({ at: schema.auditLog.at, action: schema.auditLog.action, ok: schema.auditLog.ok, companyId: schema.auditLog.companyId, target: schema.auditLog.target, ip: schema.auditLog.ip })
    .from(schema.auditLog).where(eq(schema.auditLog.userId, userId)).orderBy(desc(schema.auditLog.at)).limit(10_000);
  return {
    format: "mogyorosi.erp/personal-data", exportedAt: new Date().toISOString(),
    account: {
      id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, organization: org ?? null,
      isAdmin: u.isAdmin, twoFactorEnabled: !!u.totpEnabledAt, termsAcceptedAt: u.termsAcceptedAt, termsVersion: u.termsVersion,
    },
    memberships, dailySummaryRecipient: summaries, activity,
    note: "A cégek könyvelési adatai (számlák, napló stb.) a cég adatai, nem személyes adataid – azokat a cég teljes mentése tartalmazza (Admin › Mentés).",
  };
}

/** Miért nem törölhető most a fiók (üres = törölhető). */
export async function deletionBlockers(userId: number): Promise<string[]> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return ["A felhasználó nem található."];
  const out: string[] = [];
  if (u.isPlatformAdmin) out.push("Az üzemeltetői fiók nem törölhető innen.");
  // egyedüli tulajdonos olyan cégnél, ahol más is dolgozik
  const owned = await db.select({ cid: schema.memberships.companyId, name: schema.companies.name }).from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.role, "owner")));
  for (const o of owned) {
    const [others] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.companyId, o.cid), ne(schema.memberships.userId, userId)));
    const [owners] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.companyId, o.cid), eq(schema.memberships.role, "owner"), ne(schema.memberships.userId, userId)));
    if (Number(others.n) > 0 && Number(owners.n) === 0) out.push(`${o.name}: te vagy az egyetlen tulajdonos – előbb adj tulajdonosi jogot valaki másnak.`);
    else if (Number(others.n) === 0) out.push(`${o.name}: rajtad kívül senki nem fér hozzá – előbb archiváld és töröld a céget (vagy adj hozzá egy másik tulajdonost), különben elérhetetlenné válna.`);
  }
  if (u.isAdmin && u.organizationId) {
    const [admins] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.organizationId, u.organizationId), eq(schema.users.isAdmin, true), ne(schema.users.id, userId), sql`${schema.users.email} not like ${`%@${DELETED_DOMAIN}`}`));
    const [users] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.organizationId, u.organizationId), ne(schema.users.id, userId), sql`${schema.users.email} not like ${`%@${DELETED_DOMAIN}`}`));
    if (Number(users.n) > 0 && Number(admins.n) === 0) out.push("Te vagy az ügyfélfiók egyetlen adminja – előbb adj admin jogot valaki másnak (Admin – hozzáférések).");
  }
  return out;
}

/** Álnevesítés: a fiók azonosító adatai törlődnek, a hivatkozások (ki könyvelt) egy „Törölt felhasználó”-ra mutatnak. */
async function anonymize(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userIds: number[]) {
  if (!userIds.length) return;
  const rows = await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, userIds));
  const unusable = await hashPassword(randomBytes(32).toString("hex"));
  for (const r of rows) {
    await tx.update(schema.users).set({
      email: anonEmail(r.id), name: "Törölt felhasználó", passwordHash: unusable, isAdmin: false,
      totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], mfaFailedCount: 0, mfaLockedUntil: null,
      sessionVersion: sql`${schema.users.sessionVersion} + 1`, termsAcceptedAt: null, termsVersion: null,
    }).where(eq(schema.users.id, r.id));
    await tx.update(schema.auditLog).set({ userEmail: anonEmail(r.id) }).where(eq(schema.auditLog.userId, r.id));
    await tx.delete(schema.summaryRecipients).where(eq(schema.summaryRecipients.email, r.email));
    await tx.delete(schema.authThrottle).where(eq(schema.authThrottle.key, `email:${r.email.toLowerCase()}`));
  }
  await tx.delete(schema.memberships).where(inArray(schema.memberships.userId, userIds));
  await tx.delete(schema.userTokens).where(inArray(schema.userTokens.userId, userIds));
}

export async function deleteOwnAccount(userId: number) {
  const b = await deletionBlockers(userId);
  if (b.length) throw new Error(b.join(" "));
  await db.transaction((tx) => anonymize(tx, [userId]));
}

/** Az ügyfélfiók megszüntetése: csak cégek nélkül; az előfizetés lemondva, minden felhasználó álnevesítve. */
export async function closeOrganization(organizationId: number) {
  const [{ n }] = await db.select({ n: count() }).from(schema.companies).where(eq(schema.companies.organizationId, organizationId));
  if (Number(n) > 0) throw new Error(`Az ügyfélfiókban még ${n} cég van – előbb mentsd le, archiváld és töröld véglegesen őket (Cégeim › Cég archiválása).`);
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new Error("Az ügyfélfiók nem található.");
  if (org.stripeSubscriptionId && org.subStatus !== "canceled") {
    const { stripe, stripeConfigured } = await import("@/lib/billing");
    if (stripeConfigured()) await stripe().subscriptions.cancel(org.stripeSubscriptionId).catch((e: Error) => { throw new Error(`Az előfizetés lemondása nem sikerült: ${e.message}`); });
  }
  const users = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.organizationId, organizationId));
  await db.transaction(async (tx) => {
    await anonymize(tx, users.map((u) => u.id));
    await tx.update(schema.organizations).set({ name: `Megszüntetett ügyfélfiók #${organizationId}`, subStatus: "canceled", billingEmail: null, cancelAtPeriodEnd: false }).where(eq(schema.organizations.id, organizationId));
  });
}
