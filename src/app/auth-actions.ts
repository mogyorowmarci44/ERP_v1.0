"use server";

import { redirect } from "next/navigation";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession, destroySession, hashPassword, verifyPassword, requireUser, startMfa, getPendingMfa, clearPendingMfa } from "@/lib/auth";
import { verifyTotp, normalizeRecoveryCode, hashRecoveryCode } from "@/lib/totp";
import { mfaRequired } from "@/lib/app-settings";
import { audit } from "@/lib/audit";
import { clientIp, emailKey, ipKey, throttleClear, throttleFail, throttleLockedMinutes } from "@/lib/throttle";
import { ACCOUNT_LIMIT, IP_LIMIT, RESET_LIMIT } from "@/lib/throttle-calc";
import { consumeUserToken, createUserToken, mailTokenLink, tokenLink, sendInvite } from "@/lib/user-tokens";
import { canPurge, daysUntilPurge, exportFresh, EXPORT_MAX_AGE_HOURS } from "@/lib/archive-calc";
import { TERMS_VERSION } from "@/lib/vendor";
import { assertUserLimit } from "@/lib/billing";
import { createCompany } from "@/lib/ledger";
import { taxProfileFromForm } from "@/lib/entity";
import { parseActivityProfile } from "@/lib/activity";
import { wipeCompanyData } from "@/lib/importer";
import { runOrRedirect, str, optStr } from "@/lib/action-utils";

const MFA_MAX_FAILS = 5;
const MFA_LOCK_MIN = 15;

function assertNotLocked(u: { mfaLockedUntil: Date | null }) {
  if (u.mfaLockedUntil && u.mfaLockedUntil > new Date()) {
    const min = Math.ceil((u.mfaLockedUntil.getTime() - Date.now()) / 60000);
    throw new Error(`Túl sok hibás kód – a belépés ${min} percig zárolva.`);
  }
}

/** Ha a felhasználó nem létezik, akkor is lefut egy bcrypt-összevetés – így a válaszidőből nem derül ki, létezik-e a fiók. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

const actorOf = (u: { id: number; email: string; organizationId: number | null }) => ({ id: u.id, email: u.email, organizationId: u.organizationId });

/**
 * 1. lépés: jelszó. Siker esetén a 2FA kód megadására (vagy első alkalommal a 2FA beállítására) irányít.
 * v6.0.0: fiókonként 5, IP-címenként 30 hibás próbálkozás után ideiglenes zárolás – ilyenkor a jelszót sem nézzük.
 */
export async function loginAction(fd: FormData) {
  await runOrRedirect("/login", async () => {
    const email = str(fd, "email").toLowerCase();
    const ip = await clientIp();
    const lockedIp = await throttleLockedMinutes(ipKey(ip));
    const lockedAcc = email ? await throttleLockedMinutes(emailKey(email)) : 0;
    if (lockedIp || lockedAcc) {
      const [lu] = email ? await db.select().from(schema.users).where(eq(schema.users.email, email)) : [];
      await audit({ action: "login.locked", ok: false, user: lu ? actorOf(lu) : null, target: email || null });
      throw new Error(`Túl sok sikertelen próbálkozás – a belépés ${Math.max(lockedIp, lockedAcc)} percig szünetel.`);
    }
    const [u] = email ? await db.select().from(schema.users).where(eq(schema.users.email, email)) : [];
    const pwOk = await verifyPassword(str(fd, "password"), u?.passwordHash ?? (await getDummyHash()));
    if (!u || !pwOk) {
      const accLocked = email ? await throttleFail(emailKey(email), ACCOUNT_LIMIT) : false;
      const ipLocked = await throttleFail(ipKey(ip), IP_LIMIT);
      await audit({ action: "login.fail", ok: false, user: u ? actorOf(u) : null, target: email || null });
      if (accLocked || ipLocked) throw new Error(`Túl sok sikertelen próbálkozás – a belépés ${accLocked ? ACCOUNT_LIMIT.lockMin : IP_LIMIT.lockMin} percig szünetel.`);
      throw new Error("Hibás e-mail cím vagy jelszó.");
    }
    await throttleClear(emailKey(email));
    if (!(await mfaRequired(u.organizationId))) {
      // az ügyfélfiók adminja kikapcsolta a kötelező 2FA-t: elég a jelszó
      await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
      await createSession(u, "none");
      await audit({ action: "login.ok", user: actorOf(u), details: { method: "jelszó" } });
      return "/";
    }
    assertNotLocked(u);
    return startMfa(u);
  });
}

async function finishLogin(u: { id: number; sessionVersion: number; email: string; organizationId: number | null }, set: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.update(schema.users).set({ mfaFailedCount: 0, mfaLockedUntil: null, lastLoginAt: new Date(), ...set }).where(eq(schema.users.id, u.id));
  await clearPendingMfa();
  await createSession(u);
  await audit({ action: set.totpEnabledAt ? "mfa.setup" : "login.ok", user: actorOf(u), details: { method: "2FA" } });
}

async function registerFail(u: { id: number; mfaFailedCount: number; email: string; organizationId: number | null }) {
  await audit({ action: "mfa.fail", ok: false, user: actorOf(u) });
  const n = u.mfaFailedCount + 1;
  const lock = n >= MFA_MAX_FAILS;
  await db.update(schema.users)
    .set({ mfaFailedCount: lock ? 0 : n, mfaLockedUntil: lock ? new Date(Date.now() + MFA_LOCK_MIN * 60000) : null })
    .where(eq(schema.users.id, u.id));
  return lock ? `Túl sok hibás kód – a belépés ${MFA_LOCK_MIN} percig zárolva.` : `Hibás kód (még ${MFA_MAX_FAILS - n} próbálkozás).`;
}

/** 2. lépés: a hitelesítő alkalmazás 6 jegyű kódja, vagy egy tartalékkód. */
export async function verifyMfaAction(fd: FormData) {
  await runOrRedirect("/login/2fa", async () => {
    const p = await getPendingMfa();
    if (!p || p.pending.stage !== "verify" || !p.user.totpSecret) {
      await clearPendingMfa();
      return "/login?error=" + encodeURIComponent("A belépési idő lejárt – add meg újra a jelszavad.");
    }
    const u = p.user;
    assertNotLocked(u);
    const code = str(fd, "code");
    if (/^\d[\d\s]*$/.test(code)) {
      const step = verifyTotp(u.totpSecret!, code, { afterStep: u.totpLastStep });
      if (step === null) throw new Error(await registerFail(u));
      await finishLogin(u, { totpLastStep: step });
      return "/";
    }
    const norm = normalizeRecoveryCode(code);
    if (norm.length !== 10) throw new Error(await registerFail(u));
    const h = hashRecoveryCode(norm);
    for (let i = 0; i < u.recoveryCodes.length; i++) {
      if (u.recoveryCodes[i] === h) {
        const left = u.recoveryCodes.filter((_, j) => j !== i);
        await finishLogin(u, { recoveryCodes: left });
        return `/?ok=${encodeURIComponent(`Beléptél tartalékkóddal – ${left.length} tartalékkód maradt.${left.length <= 3 ? " Kérd az admint a 2FA újrabeállítására." : ""}`)}`;
      }
    }
    throw new Error(await registerFail(u));
  });
}

/** Első belépéskor: a hitelesítő alkalmazás hozzáadásának megerősítése egy kóddal. */
export async function confirmMfaSetupAction(fd: FormData) {
  await runOrRedirect("/login/2fa/setup", async () => {
    const p = await getPendingMfa();
    if (!p || p.pending.stage !== "setup") {
      await clearPendingMfa();
      return "/login?error=" + encodeURIComponent("A beállítási idő lejárt – lépj be újra.");
    }
    if (p.user.totpEnabledAt) throw new Error("A kétlépcsős azonosítás már be van állítva.");
    if (fd.get("saved") !== "on") throw new Error("Jelöld be, hogy elmentetted a tartalékkódokat.");
    const step = verifyTotp(p.pending.secret, str(fd, "code"));
    if (step === null) throw new Error("Hibás kód – ellenőrizd, hogy a telefon órája pontos-e, és próbáld a következő kóddal.");
    const hashes = p.pending.codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)));
    await finishLogin(p.user, { totpSecret: p.pending.secret, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes });
    return `/?ok=${encodeURIComponent("Kétlépcsős azonosítás bekapcsolva.")}`;
  });
}

/** Félbehagyott 2FA lépés megszakítása (vissza a jelszóhoz). */
export async function cancelMfaAction() {
  await clearPendingMfa();
  redirect("/login");
}

export async function logoutAction() {
  await audit({ action: "logout" });
  await destroySession();
  redirect("/login");
}

/** Első indításkor: admin felhasználó létrehozása (csak ha még nincs felhasználó). */
export async function setupAction(fd: FormData) {
  await runOrRedirect("/setup", async () => {
    const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.users);
    if (n > 0) throw new Error("A rendszer már be van állítva.");
    const pw = str(fd, "password");
    if (pw.length < 10) throw new Error("A jelszó legalább 10 karakter legyen.");
    if (fd.get("terms") !== "on") throw new Error("Az ÁSZF és az adatkezelési tájékoztató elfogadása szükséges.");
    // v6.0.0 – az első felhasználó az üzemeltető és az első ügyfélfiók adminja
    // az üzemeltető saját ügyfélfiókja díjmentes
    const [org] = await db.insert(schema.organizations).values({ name: str(fd, "orgName") || str(fd, "name"), subStatus: "comped" }).returning();
    const [u] = await db
      .insert(schema.users)
      .values({ email: str(fd, "email").toLowerCase(), name: str(fd, "name"), passwordHash: await hashPassword(pw), isAdmin: true, isPlatformAdmin: true, organizationId: org.id, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION })
      .returning();
    await audit({ action: "org.create", user: actorOf(u), organizationId: org.id, target: org.name });
    if (!(await mfaRequired(u.organizationId))) { await createSession(u, "none"); return "/"; }
    return startMfa(u);
  });
}

export async function createCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const name = str(fd, "name");
    if (!name) throw new Error("A cégnév kötelező.");
    await assertCanCreateCompany(user.organizationId);
    const c = await createCompany(user.id, {
      name,
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      registrationNumber: optStr(fd, "registrationNumber"),
      address: optStr(fd, "address"),
      vatPeriod: (str(fd, "vatPeriod") || "monthly") as "monthly" | "quarterly" | "yearly",
      // v5.0.0 – sablon: autókereskedés vagy általános Kft (egyelőre azonos számlatükör és felület)
      activityProfile: parseActivityProfile(str(fd, "activityProfile")),
    });
    await audit({ action: "company.create", companyId: c.id, target: c.name });
    return `/c/${c.id}`;
  });
}

/** v2.0 – Adószámos magánszemély (pl. vendégház) felvétele saját számlatükörrel és adózási profillal. */
export async function createPrivateTaxpayerAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const name = str(fd, "name");
    if (!name) throw new Error("A név kötelező (pl. „Vendégház – <település>”).");
    await assertCanCreateCompany(user.organizationId);
    const c = await createCompany(user.id, {
      name,
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      address: optStr(fd, "address"),
      vatPeriod: (str(fd, "vatPeriod") || "quarterly") as "monthly" | "quarterly" | "yearly",
      entityType: "private_taxpayer",
      taxProfile: taxProfileFromForm(fd),
    });
    await audit({ action: "company.create", companyId: c.id, target: c.name });
    return `/c/${c.id}/taxes`;
  });
}

/**
 * Felhasználó hozzáadása egy céghez (tulajdonosként).
 * v6.0.0: csak a cég ügyfélfiókjába tartozó felhasználó adható hozzá; új e-mail címnél meghívó link megy ki
 * (a jelszót a meghívott maga állítja be). Ha a levélküldés nincs beállítva, a linket itt mutatjuk meg továbbadásra.
 */
export async function addMemberAction(fd: FormData) {
  const user = await requireUser();
  const companyId = Number(fd.get("companyId"));
  await runOrRedirect(`/c/${companyId}/settings`, async () => {
    const [m] = await db
      .select({ role: schema.memberships.role, orgId: schema.companies.organizationId, companyName: schema.companies.name, archivedAt: schema.companies.archivedAt })
      .from(schema.memberships)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.companyId, companyId)));
    if (!m || m.role !== "owner") throw new Error("Csak tulajdonos adhat hozzá felhasználót.");
    if (m.archivedAt) throw new Error("Archivált céghez nem adható hozzá felhasználó.");
    const email = str(fd, "email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adj meg érvényes e-mail címet.");
    const role = (str(fd, "role") || "accountant") as "owner" | "accountant" | "viewer" | "uploader";
    if (!["owner", "accountant", "viewer", "uploader"].includes(role)) throw new Error("Ismeretlen szerepkör.");
    let [target] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    let note = "Felhasználó hozzáadva.";
    if (target && target.organizationId !== m.orgId) throw new Error("Ez az e-mail cím egy másik ügyfélfiókhoz tartozik – nem adható hozzá.");
    if (!target) {
      // v6.11.0 – a bizonylatfeltöltő (az ügyfél, aki csak fotóz) nem számít bele a csomag felhasználókeretébe
      if (role !== "uploader") await assertUserLimit(m.orgId);
      [target] = await db
        .insert(schema.users)
        .values({ email, name: str(fd, "name") || email, passwordHash: await hashPassword(randomUnusablePassword()), organizationId: m.orgId })
        .returning();
      note = await sendInvite(target, user, m.companyName);
    }
    await db
      .insert(schema.memberships)
      .values({ userId: target.id, companyId, role })
      .onConflictDoNothing();
    await audit({ action: "access.set", companyId, target: email, details: { role } });
    return `/c/${companyId}/settings?ok=${encodeURIComponent(note)}`;
  });
}

/** Véletlen, ki nem adott jelszó a meghívottnak – belépni csak a meghívó linken beállított jelszóval tud. */
function randomUnusablePassword() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function changePasswordAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    if (!(await verifyPassword(str(fd, "current"), user.passwordHash))) throw new Error("A jelenlegi jelszó hibás.");
    const pw = str(fd, "password");
    if (pw.length < 10) throw new Error("Az új jelszó legalább 10 karakter legyen.");
    // a többi eszközön lévő munkamenet kilép, ez az eszköz bejelentkezve marad
    const [u] = await db.update(schema.users).set({ passwordHash: await hashPassword(pw), sessionVersion: dsql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, user.id)).returning();
    await createSession(u, (await mfaRequired(u.organizationId)) ? "totp" : "none");
    await audit({ action: "password.change", user: actorOf(u) });
    return `/?ok=${encodeURIComponent("Jelszó módosítva.")}`;
  });
}

// ---------------------------------------------------------------------------
// v6.0.0 – Cég archiválása, visszaállítása, végleges törlése
// ---------------------------------------------------------------------------

async function ownedCompany(userId: number, cid: number) {
  if (!Number.isInteger(cid) || cid <= 0) throw new Error("Válaszd ki a céget.");
  const [m] = await db
    .select({ role: schema.memberships.role, name: schema.companies.name, archivedAt: schema.companies.archivedAt, lastFullExportAt: schema.companies.lastFullExportAt })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, cid)));
  if (!m) throw new Error("A cég nem található.");
  if (m.role !== "owner") throw new Error("Ezt csak a cég tulajdonosa teheti meg.");
  return m;
}

/**
 * Archiválás (a korábbi azonnali törlés helyett): előfeltétel egy 24 órán belüli teljes adatexport.
 * Archivált cég csak olvasható, kikerül a listákból és a napi összefoglalóból, és bármikor visszaállítható.
 */
export async function archiveCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const cid = Number(fd.get("companyId"));
    const m = await ownedCompany(user.id, cid);
    if (m.archivedAt) throw new Error("A cég már archivált.");
    if (!exportFresh(m.lastFullExportAt, new Date()))
      throw new Error(`Archiválás előtt töltsd le a cég teljes mentését (az elmúlt ${EXPORT_MAX_AGE_HOURS} órában) – a lenti „Teljes mentés letöltése” gombbal.`);
    if (!(await verifyPassword(str(fd, "password"), user.passwordHash))) throw new Error("Hibás jelszó – a cég nem lett archiválva.");
    await db.update(schema.companies).set({ archivedAt: new Date(), archivedBy: user.id }).where(eq(schema.companies.id, cid));
    await audit({ action: "company.archive", companyId: cid, target: m.name });
    return `/?ok=${encodeURIComponent(`„${m.name}” archiválva – csak olvasható, és bármikor visszaállítható.`)}`;
  });
}

export async function restoreCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const cid = Number(fd.get("companyId"));
    const m = await ownedCompany(user.id, cid);
    if (!m.archivedAt) throw new Error("A cég nincs archiválva.");
    await db.update(schema.companies).set({ archivedAt: null, archivedBy: null }).where(eq(schema.companies.id, cid));
    await audit({ action: "company.restore", companyId: cid, target: m.name });
    return `/?ok=${encodeURIComponent(`„${m.name}” visszaállítva.`)}`;
  });
}

/**
 * Végleges törlés: csak archivált cégnél, a türelmi idő (30 nap) letelte után, jelszóval és a megőrzési kötelezettség
 * tudomásulvételével. A tevékenységnapló bejegyzései megmaradnak.
 */
export async function purgeCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const cid = Number(fd.get("companyId"));
    const m = await ownedCompany(user.id, cid);
    const now = new Date();
    if (!m.archivedAt) throw new Error("Véglegesen csak archivált cég törölhető.");
    if (!canPurge(m.archivedAt, now)) throw new Error(`A végleges törlés még ${daysUntilPurge(m.archivedAt, now)} nap múlva lesz elérhető.`);
    if (fd.get("retention") !== "on") throw new Error("Jelöld be, hogy a bizonylatok megőrzéséről (8 év) az exportból gondoskodtál.");
    if (fd.get("understand") !== "on") throw new Error("Jelöld be, hogy tudomásul veszed: a törlés végleges.");
    if (!(await verifyPassword(str(fd, "password"), user.passwordHash))) throw new Error("Hibás jelszó – a cég nem lett törölve.");
    await wipeCompanyData(cid);
    await db.delete(schema.companies).where(eq(schema.companies.id, cid));
    await audit({ action: "company.purge", companyId: cid, target: m.name });
    return `/?ok=${encodeURIComponent(`„${m.name}” véglegesen törölve.`)}`;
  });
}

// ---------------------------------------------------------------------------
// v6.0.0 – Elfelejtett jelszó, jelszó beállítása linkkel (visszaállítás és meghívó)
// ---------------------------------------------------------------------------

/** Mindig ugyanazt válaszolja, akár létezik a fiók, akár nem. Címenként óránként legfeljebb 10 kérés. */
export async function forgotPasswordAction(fd: FormData) {
  await runOrRedirect("/login/forgot", async () => {
    const ip = await clientIp();
    if (await throttleLockedMinutes(`reset:${ip}`)) throw new Error("Túl sok kérés – próbáld újra egy óra múlva.");
    await throttleFail(`reset:${ip}`, RESET_LIMIT);
    const email = str(fd, "email").toLowerCase();
    const [u] = email ? await db.select().from(schema.users).where(eq(schema.users.email, email)) : [];
    if (u) {
      const raw = await createUserToken(u.id, "reset");
      const sent = await mailTokenLink(u.email, u.name, await tokenLink(raw, "reset"), "reset");
      await audit({ action: "password.resetRequest", ok: sent, user: actorOf(u), details: sent ? null : { message: "a levélküldés nincs beállítva" } });
    }
    return "/login?ok=" + encodeURIComponent("Ha ez az e-mail cím szerepel a rendszerben, elküldtük rá a jelszó-visszaállító linket (1 óráig érvényes). Ha nem érkezik meg, kérd az ügyfélfiókod adminját.");
  });
}

/** Új jelszó a linkkel (jelszó-visszaállítás vagy meghívó elfogadása). Minden korábbi munkamenet kilép. */
export async function resetPasswordAction(fd: FormData) {
  const raw = str(fd, "t");
  const back = `/login/reset?t=${encodeURIComponent(raw)}${fd.get("invite") ? "&invite=1" : ""}`;
  await runOrRedirect(back, async () => {
    const pw = str(fd, "password");
    if (pw.length < 10) throw new Error("A jelszó legalább 10 karakter legyen.");
    if (pw !== str(fd, "password2")) throw new Error("A két jelszó nem egyezik.");
    const invite = !!fd.get("invite");
    if (invite && fd.get("terms") !== "on") throw new Error("Az ÁSZF és az adatkezelési tájékoztató elfogadása szükséges.");
    const r = await consumeUserToken(raw);
    if (!r) return "/login?error=" + encodeURIComponent("A link lejárt vagy már fel lett használva – kérj újat.");
    await db.update(schema.users).set({
      passwordHash: await hashPassword(pw), sessionVersion: dsql`${schema.users.sessionVersion} + 1`, mfaFailedCount: 0, mfaLockedUntil: null,
      ...(invite ? { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } : {}),
    }).where(eq(schema.users.id, r.user.id));
    await throttleClear(emailKey(r.user.email));
    await audit({ action: r.token.purpose === "invite" ? "invite.accept" : "password.reset", user: actorOf(r.user) });
    return "/login?ok=" + encodeURIComponent(r.token.purpose === "invite" ? "Fiók aktiválva – lépj be az e-mail címeddel és az új jelszavaddal." : "Jelszó beállítva – lépj be az új jelszóval.");
  });
}

/** v6.1.0 – Az ÁSZF és az adatkezelési tájékoztató (aktuális változatának) elfogadása. */
export async function acceptTermsAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    if (fd.get("terms") !== "on") throw new Error("Jelöld be az elfogadást.");
    await db.update(schema.users).set({ termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION }).where(eq(schema.users.id, user.id));
    await audit({ action: "terms.accept", details: { version: TERMS_VERSION } });
    return `/?ok=${encodeURIComponent("Köszönjük, elfogadva.")}`;
  });
}

/** v6.8.0 – új cég: írható ügyfélfiók és a csomag cégszám-korlátja. */
async function assertCanCreateCompany(organizationId: number | null) {
  const { orgAccess, assertCompanyLimit } = await import("@/lib/billing");
  const a = await orgAccess(organizationId);
  if (!a.writable) throw new Error(`${a.reason} Új cég nem hozható létre – előfizetés: Admin › Előfizetés.`);
  await assertCompanyLimit(organizationId);
}

// ---------------------------------------------------------------------------
// v6.12.0 – Bemutató cég
// ---------------------------------------------------------------------------

/** Bemutató cég mintaadatokkal (ügyfélfiókonként egy; nem számít a csomag keretébe). */
export async function createDemoCompanyAction() {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const { createDemoCompany, demoCompanyOf } = await import("@/lib/demo");
    const existing = await demoCompanyOf(user.organizationId);
    if (existing) return `/c/${existing}`;
    const { orgAccess } = await import("@/lib/billing");
    const a = await orgAccess(user.organizationId);
    if (!a.writable) throw new Error(`${a.reason} Bemutató cég nem hozható létre.`);
    const c = await createDemoCompany(user.id);
    await audit({ action: "company.demo.create", companyId: c.id, target: "bemutató cég" });
    return `/c/${c.id}?ok=${encodeURIComponent("Kész a bemutató cég – nézz körül nyugodtan, bármit kipróbálhatsz rajta.")}`;
  });
}

/** A bemutató cég azonnal (türelmi idő és jelszó nélkül) törölhető – csak a tulajdonosa, és csak ha valóban bemutató cég. */
export async function deleteDemoCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const cid = Number(fd.get("companyId"));
    const m = await ownedCompany(user.id, cid);
    const [c] = await db.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, cid));
    const { isDemo } = await import("@/lib/demo");
    if (!c || !isDemo(c)) throw new Error("Csak a bemutató cég törölhető így.");
    await wipeCompanyData(cid);
    await db.delete(schema.companies).where(eq(schema.companies.id, cid));
    await audit({ action: "company.demo.delete", companyId: cid, target: m.name });
    return `/?ok=${encodeURIComponent("A bemutató cég törölve.")}`;
  });
}

// ---------------------------------------------------------------------------
// v7.6.0 – Önkiszolgáló fióktörlés és ügyfélfiók-megszüntetés (GDPR)
// ---------------------------------------------------------------------------

export async function deleteMyAccountAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/fiokom", async () => {
    if (!(await verifyPassword(str(fd, "password"), user.passwordHash))) throw new Error("A jelszó hibás.");
    if (str(fd, "confirm").trim().toUpperCase() !== "TÖRLÖM") throw new Error("A megerősítéshez írd be: TÖRLÖM");
    const { deleteOwnAccount } = await import("@/lib/privacy");
    await audit({ action: "account.delete", user: actorOf(user) });
    await deleteOwnAccount(user.id);
    await destroySession();
    return `/login?ok=${encodeURIComponent("A fiókodat töröltük. A személyes adataidat álnevesítettük; a könyvelési tételek a cégnél maradnak.")}`;
  });
}

export async function closeOrganizationAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/fiokom", async () => {
    if (!user.isAdmin || !user.organizationId) throw new Error("Az ügyfélfiókot csak az adminja szüntetheti meg.");
    if (!(await verifyPassword(str(fd, "password"), user.passwordHash))) throw new Error("A jelszó hibás.");
    if (str(fd, "confirm").trim().toUpperCase() !== "MEGSZÜNTETEM") throw new Error("A megerősítéshez írd be: MEGSZÜNTETEM");
    const { closeOrganization } = await import("@/lib/privacy");
    await audit({ action: "org.close", user: actorOf(user), organizationId: user.organizationId });
    await closeOrganization(user.organizationId);
    await destroySession();
    return `/login?ok=${encodeURIComponent("Az ügyfélfiókot megszüntettük, az előfizetést lemondtuk, a felhasználókat álnevesítettük.")}`;
  });
}
