"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, requireAdmin, requirePlatformAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { setMfaRequired } from "@/lib/app-settings";
import { audit } from "@/lib/audit";
import { sendInvite } from "@/lib/user-tokens";

const { users, memberships, companies } = schema;

/** v6.0.0 – az ügyfélfiók adminja csak a saját ügyfélfiókja felhasználóit kezelheti. */
async function orgUser(orgId: number, userId: number) {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, orgId)));
  if (!u) throw new Error("A felhasználó nem található ebben az ügyfélfiókban.");
  return u;
}
async function orgCompany(orgId: number, companyId: number) {
  const [c] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.id, companyId), eq(companies.organizationId, orgId)));
  if (!c) throw new Error("A cég nem található ebben az ügyfélfiókban.");
  return c;
}
const ROLES = new Set(["owner", "accountant", "viewer"]);
const ok = (msg: string) => `/admin?ok=${encodeURIComponent(msg)}`;

/** Hozzáférés beállítása egy felhasználónak egy céghez: szerepkör megadása / módosítása, vagy „none” = elvétel. */
export async function setAccessAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const userId = Number(fd.get("userId"));
    const companyId = Number(fd.get("companyId"));
    const role = str(fd, "role");
    if (!userId || !companyId) throw new Error("Hiányzó felhasználó vagy cég.");
    const target = await orgUser(admin.organizationId, userId);
    await orgCompany(admin.organizationId, companyId);
    const [cur] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
    if (cur?.role === "owner" && role !== "owner") {
      const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(memberships)
        .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "owner"), ne(memberships.userId, userId)));
      if (n === 0) throw new Error("Ez a cég egyetlen tulajdonosa – előbb adj tulajdonosi jogot valaki másnak.");
    }
    if (role === "none") {
      if (cur) await db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
    } else {
      if (!ROLES.has(role)) throw new Error("Ismeretlen szerepkör.");
      const r = role as "owner" | "accountant" | "viewer";
      await db.insert(memberships).values({ userId, companyId, role: r }).onConflictDoUpdate({ target: [memberships.userId, memberships.companyId], set: { role: r } });
    }
    await audit({ action: "access.set", companyId, target: target.email, details: { role } });
    revalidatePath("/admin");
    return ok(role === "none" ? "Hozzáférés megvonva." : "Hozzáférés mentve.");
  });
}

/** Elveszett telefon esetén: a felhasználó 2FA-ja törlődik, minden munkamenete kilép, a következő belépéskor újra beállítja. */
export async function resetMfaAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const userId = Number(fd.get("userId"));
    const t = await orgUser(admin.organizationId, userId);
    await audit({ action: "mfa.reset", target: t.email });
    const [u] = await db.update(users).set({
      totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], mfaFailedCount: 0, mfaLockedUntil: null,
      sessionVersion: dsql`${users.sessionVersion} + 1`,
    }).where(eq(users.id, userId)).returning({ name: users.name });
    if (!u) throw new Error("A felhasználó nem található.");
    if (userId === admin.id) return "/login?error=" + encodeURIComponent("A saját 2FA-d visszaállítva – lépj be újra és állítsd be.");
    revalidatePath("/admin");
    return ok(`${u.name}: 2FA visszaállítva, minden eszközről kiléptetve. Következő belépéskor újra beállítja.`);
  });
}

/** Felhasználó kiléptetése minden eszközről (a 2FA marad). */
export async function logoutEverywhereAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const userId = Number(fd.get("userId"));
    const t = await orgUser(admin.organizationId, userId);
    await audit({ action: "user.logoutEverywhere", target: t.email });
    const [u] = await db.update(users).set({ sessionVersion: dsql`${users.sessionVersion} + 1`, mfaFailedCount: 0, mfaLockedUntil: null })
      .where(eq(users.id, userId)).returning({ name: users.name });
    if (!u) throw new Error("A felhasználó nem található.");
    if (userId === admin.id) return "/login";
    revalidatePath("/admin");
    return ok(`${u.name} kiléptetve minden eszközről.`);
  });
}

/** A kötelező kétlépcsős azonosítás be- és kikapcsolása az egész rendszerre. A beállított hitelesítők megmaradnak. */
export async function setMfaRequiredAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const on = fd.get("on") === "1";
    await setMfaRequired(admin.organizationId, on);
    await audit({ action: "org.mfaRequired", details: { on } });
    revalidatePath("/admin");
    // bekapcsoláskor a csak jelszóval szerzett munkamenetek érvénytelenné válnak – ha az adminé is ilyen, újra be kell lépnie
    return on ? "/admin?ok=" + encodeURIComponent("Kétlépcsős azonosítás bekapcsolva – az ügyfélfiókban mindenkinek kötelező.") : "/admin?ok=" + encodeURIComponent("Kétlépcsős azonosítás kikapcsolva – a belépéshez elég a jelszó.");
  });
}

/** v6.0.0 – Új felhasználó meghívása az ügyfélfiókba (cég-hozzáférés nélkül; utána a mátrixban adható). */
export async function inviteUserAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const email = str(fd, "email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adj meg érvényes e-mail címet.");
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new Error("Ezzel az e-mail címmel már van felhasználó.");
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, admin.organizationId));
    const [u] = await db.insert(users).values({
      email, name: str(fd, "name") || email, organizationId: admin.organizationId, isAdmin: fd.get("isAdmin") === "on",
      passwordHash: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
    }).returning();
    revalidatePath("/admin");
    return ok(await sendInvite(u, admin, org?.name ?? ""));
  });
}

/** Új meghívó link (pl. lejárt az előző), csak annak, aki még soha nem lépett be. */
export async function resendInviteAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const u = await orgUser(admin.organizationId, Number(fd.get("userId")));
    if (u.lastLoginAt) throw new Error("Ő már belépett – elfelejtett jelszónál a belépő oldalon kérhet új jelszót.");
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, admin.organizationId));
    return ok(await sendInvite(u, admin, org?.name ?? ""));
  });
}

/** Ügyfélfiók-admin jog adása / elvétele (saját magától nem veheti el). */
export async function setOrgAdminAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const u = await orgUser(admin.organizationId, Number(fd.get("userId")));
    const on = fd.get("on") === "1";
    if (!on && u.id === admin.id) throw new Error("A saját admin jogodat nem veheted el.");
    await db.update(users).set({ isAdmin: on }).where(eq(users.id, u.id));
    await audit({ action: "access.set", target: u.email, details: { orgAdmin: on } });
    revalidatePath("/admin");
    return ok(on ? `${u.name} mostantól admin.` : `${u.name} admin joga megszűnt.`);
  });
}

// ---------------------------------------------------------------------------
// v6.0.0 – Üzemeltető: ügyfélfiókok és támogatói hozzáférés
// ---------------------------------------------------------------------------

/** Új ügyfélfiók és az első adminja (meghívóval). */
export async function createOrganizationAction(fd: FormData) {
  const me = await requirePlatformAdmin();
  await runOrRedirect("/admin/platform", async () => {
    const name = str(fd, "orgName");
    const email = str(fd, "email").toLowerCase();
    if (!name) throw new Error("Az ügyfélfiók neve kötelező.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adj meg érvényes e-mail címet az adminnak.");
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new Error("Ezzel az e-mail címmel már van felhasználó.");
    const [org] = await db.insert(schema.organizations).values({ name }).returning();
    const [u] = await db.insert(users).values({
      email, name: str(fd, "adminName") || email, organizationId: org.id, isAdmin: true,
      passwordHash: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
    }).returning();
    await audit({ action: "org.create", organizationId: org.id, target: name });
    const msg = await sendInvite(u, me, name);
    revalidatePath("/admin/platform");
    return `/admin/platform?ok=${encodeURIComponent(`„${name}” ügyfélfiók létrehozva. ${msg}`)}`;
  });
}

/** Támogatói hozzáférés egy ügyfél cégéhez: csak olvasás, 2 óráig, indoklással – az ügyfél naplójában is látszik. */
export async function grantSupportAccessAction(fd: FormData) {
  const me = await requirePlatformAdmin();
  await runOrRedirect("/admin/platform", async () => {
    const companyId = Number(fd.get("companyId"));
    const reason = str(fd, "reason");
    if (reason.length < 5) throw new Error("Írd le röviden, miért kell a hozzáférés (pl. a hibabejelentés tárgya).");
    const [c] = await db.select({ id: companies.id, name: companies.name, orgId: companies.organizationId }).from(companies).where(eq(companies.id, companyId));
    if (!c) throw new Error("A cég nem található.");
    const hours = 2;
    await db.insert(schema.supportGrants).values({ userId: me.id, companyId, reason, expiresAt: new Date(Date.now() + hours * 3_600_000) });
    await audit({ action: "support.grant", companyId, organizationId: c.orgId, target: c.name, details: { reason, hours } });
    return `/c/${companyId}`;
  });
}
