"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, requireAdmin, requirePlatformAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { setMfaRequired } from "@/lib/app-settings";
import { audit } from "@/lib/audit";
import { sendInvite } from "@/lib/user-tokens";
import { setVendor } from "@/lib/vendor";
import { assertUserLimit, trialStart } from "@/lib/billing";

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
const ROLES = new Set(["owner", "accountant", "viewer", "uploader"]);
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
      const r = role as "owner" | "accountant" | "viewer" | "uploader";
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
    await assertUserLimit(admin.organizationId);
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
    const trialDays = Math.max(0, Math.min(365, Number(fd.get("trialDays") ?? 14) || 14));
    const [org] = await db.insert(schema.organizations).values({ name, ...trialStart(trialDays), billingEmail: email }).returning();
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

/** v6.1.0 – Az üzemeltető (szolgáltató) adatai a jogi dokumentumokhoz. */
export async function saveVendorAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect("/admin/platform", async () => {
    const v = {
      name: str(fd, "name"), seat: str(fd, "seat"), regNumber: str(fd, "regNumber"), taxNumber: str(fd, "taxNumber"),
      email: str(fd, "email"), phone: str(fd, "phone"), web: str(fd, "web"), legalReviewed: fd.get("legalReviewed") === "on",
    };
    await setVendor(v);
    await audit({ action: "vendor.update", details: { legalReviewed: v.legalReviewed } });
    return `/admin/platform?ok=${encodeURIComponent("Szolgáltatói adatok mentve.")}`;
  });
}

// ---------------------------------------------------------------------------
// v6.4.0 – Jogszabályi paraméterek (üzemeltető)
// ---------------------------------------------------------------------------

export async function saveLegalParamAction(fd: FormData) {
  const me = await requirePlatformAdmin();
  await runOrRedirect("/admin/params", async () => {
    const { paramDef } = await import("@/lib/legal-params-calc");
    const { parseNumber } = await import("@/lib/money");
    const key = str(fd, "key");
    const def = paramDef(key);
    if (!def) throw new Error("Ismeretlen paraméter.");
    const validFrom = str(fd, "validFrom");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error("Adj meg hatálybalépési dátumot.");
    const value = parseNumber(fd.get("value"));
    if (!Number.isFinite(value) || value < 0) throw new Error("Érvénytelen érték.");
    const note = str(fd, "note") || null;
    await db.insert(schema.legalParams).values({ key, validFrom, value, note, updatedBy: me.id })
      .onConflictDoUpdate({ target: [schema.legalParams.key, schema.legalParams.validFrom], set: { value, note, updatedBy: me.id, updatedAt: new Date() } });
    await audit({ action: "legalParam.set", target: key, details: { validFrom, value, note } });
    revalidatePath("/", "layout");
    return `/admin/params?key=${encodeURIComponent(key)}&ok=${encodeURIComponent(`${def.label}: ${value} ${def.unit} – ${validFrom}-tól.`)}`;
  });
}

export async function deleteLegalParamAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect("/admin/params", async () => {
    const key = str(fd, "key"), validFrom = str(fd, "validFrom");
    await db.delete(schema.legalParams).where(and(eq(schema.legalParams.key, key), eq(schema.legalParams.validFrom, validFrom)));
    await audit({ action: "legalParam.delete", target: key, details: { validFrom } });
    revalidatePath("/", "layout");
    return `/admin/params?ok=${encodeURIComponent("Érték törölve.")}`;
  });
}

/** v6.7.0 – Hibanapló: hiba megoldottnak jelölése (ha újra előfordul, új sorként jelenik meg). */
export async function resolveErrorAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect("/admin/errors", async () => {
    await db.update(schema.errorLog).set({ resolvedAt: new Date() }).where(eq(schema.errorLog.id, Number(fd.get("id"))));
    return "/admin/errors?ok=" + encodeURIComponent("Megoldottnak jelölve.");
  });
}

// ---------------------------------------------------------------------------
// v6.8.0 – Csomagok és ügyfélfiókonkénti előfizetés (üzemeltető)
// ---------------------------------------------------------------------------

export async function savePlanAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect("/admin/plans", async () => {
    const num = (k: string) => { const v = str(fd, k); return v === "" ? null : Math.round(Number(v.replace(/\s/g, ""))); };
    const v = {
      code: str(fd, "code").toLowerCase(), name: str(fd, "name"), description: str(fd, "description") || null,
      priceHuf: num("priceHuf") ?? 0, interval: (str(fd, "interval") === "year" ? "year" : "month") as "month" | "year",
      stripePriceId: str(fd, "stripePriceId") || null, maxCompanies: num("maxCompanies"), maxUsers: num("maxUsers"),
      sortOrder: num("sortOrder") ?? 0, isActive: fd.get("isActive") === "on",
    };
    if (!v.code || !v.name) throw new Error("A kód és a név kötelező.");
    if (v.stripePriceId && !/^price_[A-Za-z0-9]+$/.test(v.stripePriceId)) throw new Error("A Stripe Price ID „price_” kezdetű.");
    const id = Number(fd.get("id")) || 0;
    if (id) await db.update(schema.plans).set(v).where(eq(schema.plans.id, id));
    else await db.insert(schema.plans).values(v);
    await audit({ action: "plan.save", target: v.code, details: { priceHuf: v.priceHuf, interval: v.interval } });
    return "/admin/plans?ok=" + encodeURIComponent(`„${v.name}” mentve.`);
  });
}

/** Ügyfélfiók előfizetésének kézi beállítása (díjmentes, próbaidő hosszabbítása, csomag) – pl. átutalásos ügyfélnél. */
export async function setOrgBillingAction(fd: FormData) {
  await requirePlatformAdmin();
  await runOrRedirect("/admin/platform", async () => {
    const orgId = Number(fd.get("orgId"));
    const status = str(fd, "subStatus") as "trialing" | "active" | "past_due" | "canceled" | "comped";
    if (!["trialing", "active", "past_due", "canceled", "comped"].includes(status)) throw new Error("Ismeretlen állapot.");
    const until = str(fd, "until");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T23:59:59+01:00`) : null;
    const planId = Number(fd.get("planId")) || null;
    await db.update(schema.organizations).set({
      subStatus: status, planId,
      ...(status === "trialing" ? { trialEndsAt: date } : {}),
      ...(status === "active" ? { currentPeriodEnd: date } : {}),
      pastDueSince: status === "past_due" ? new Date() : null,
    }).where(eq(schema.organizations.id, orgId));
    await audit({ action: "billing.override", organizationId: orgId, details: { status, until, planId } });
    return "/admin/platform?ok=" + encodeURIComponent("Előfizetés módosítva.");
  });
}
