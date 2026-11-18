"use server";

import { redirect } from "next/navigation";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession, destroySession, hashPassword, verifyPassword, requireUser, startMfa, getPendingMfa, clearPendingMfa } from "@/lib/auth";
import { verifyTotp, normalizeRecoveryCode, hashRecoveryCode } from "@/lib/totp";
import { createCompany } from "@/lib/ledger";
import { taxProfileFromForm } from "@/lib/entity";
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

/** 1. lépés: jelszó. Siker esetén a 2FA kód megadására (vagy első alkalommal a 2FA beállítására) irányít. */
export async function loginAction(fd: FormData) {
  await runOrRedirect("/login", async () => {
    const email = str(fd, "email").toLowerCase();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!u || !(await verifyPassword(str(fd, "password"), u.passwordHash))) throw new Error("Hibás e-mail cím vagy jelszó.");
    assertNotLocked(u);
    return startMfa(u);
  });
}

async function finishLogin(u: { id: number; sessionVersion: number }, set: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.update(schema.users).set({ mfaFailedCount: 0, mfaLockedUntil: null, lastLoginAt: new Date(), ...set }).where(eq(schema.users.id, u.id));
  await clearPendingMfa();
  await createSession(u);
}

async function registerFail(u: { id: number; mfaFailedCount: number }) {
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
    const [u] = await db
      .insert(schema.users)
      .values({ email: str(fd, "email").toLowerCase(), name: str(fd, "name"), passwordHash: await hashPassword(pw), isAdmin: true })
      .returning();
    return startMfa(u);
  });
}

export async function createCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const name = str(fd, "name");
    if (!name) throw new Error("A cégnév kötelező.");
    const c = await createCompany(user.id, {
      name,
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      registrationNumber: optStr(fd, "registrationNumber"),
      address: optStr(fd, "address"),
      vatPeriod: (str(fd, "vatPeriod") || "monthly") as "monthly" | "quarterly" | "yearly",
    });
    return `/c/${c.id}`;
  });
}

/** v2.0 – Adószámos magánszemély (pl. vendégház) felvétele saját számlatükörrel és adózási profillal. */
export async function createPrivateTaxpayerAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const name = str(fd, "name");
    if (!name) throw new Error("A név kötelező (pl. „Vendégház – Szigetvár”).");
    const c = await createCompany(user.id, {
      name,
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      address: optStr(fd, "address"),
      vatPeriod: (str(fd, "vatPeriod") || "quarterly") as "monthly" | "quarterly" | "yearly",
      entityType: "private_taxpayer",
      taxProfile: taxProfileFromForm(fd),
    });
    return `/c/${c.id}/taxes`;
  });
}

/** Meglévő felhasználó hozzáadása egy céghez (pl. az öcsém). Admin hozhat létre új felhasználót is. */
export async function addMemberAction(fd: FormData) {
  const user = await requireUser();
  const companyId = Number(fd.get("companyId"));
  await runOrRedirect(`/c/${companyId}/settings`, async () => {
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(dsql`${schema.memberships.userId} = ${user.id} and ${schema.memberships.companyId} = ${companyId}`);
    if (!m || m.role !== "owner") throw new Error("Csak tulajdonos adhat hozzá felhasználót.");
    const email = str(fd, "email").toLowerCase();
    let [target] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!target) {
      const pw = str(fd, "password");
      if (pw.length < 10) throw new Error("Új felhasználóhoz legalább 10 karakteres kezdő jelszó kell.");
      [target] = await db
        .insert(schema.users)
        .values({ email, name: str(fd, "name") || email, passwordHash: await hashPassword(pw) })
        .returning();
    }
    await db
      .insert(schema.memberships)
      .values({ userId: target.id, companyId, role: (str(fd, "role") || "accountant") as "owner" | "accountant" | "viewer" })
      .onConflictDoNothing();
    return `/c/${companyId}/settings?ok=${encodeURIComponent("Felhasználó hozzáadva.")}`;
  });
}

export async function changePasswordAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    if (!(await verifyPassword(str(fd, "current"), user.passwordHash))) throw new Error("A jelenlegi jelszó hibás.");
    const pw = str(fd, "password");
    if (pw.length < 10) throw new Error("Az új jelszó legalább 10 karakter legyen.");
    // a többi eszközön lévő munkamenet kilép, ez az eszköz bejelentkezve marad
    const [u] = await db.update(schema.users).set({ passwordHash: await hashPassword(pw), sessionVersion: dsql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, user.id)).returning();
    await createSession(u);
    return `/?ok=${encodeURIComponent("Jelszó módosítva.")}`;
  });
}

/**
 * Cég / magánszemély végleges törlése – csak a „Cégeim” oldalról, a felhasználó jelszavával megerősítve.
 * Csak a cég tulajdonosa törölheti. Minden adat (számlák, tételek, partnerek, számlatükör, beállítások) törlődik.
 */
export async function deleteCompanyAction(fd: FormData) {
  const user = await requireUser();
  await runOrRedirect("/", async () => {
    const cid = Number(fd.get("companyId"));
    if (!Number.isInteger(cid) || cid <= 0) throw new Error("Válaszd ki a törlendő céget.");
    const [m] = await db
      .select({ role: schema.memberships.role, name: schema.companies.name })
      .from(schema.memberships)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.companyId, cid)));
    if (!m) throw new Error("A cég nem található.");
    if (m.role !== "owner") throw new Error("Cégét csak a tulajdonosa törölheti.");
    if (fd.get("understand") !== "on") throw new Error("Jelöld be, hogy tudomásul veszed: a törlés végleges.");
    if (!(await verifyPassword(str(fd, "password"), user.passwordHash))) throw new Error("Hibás jelszó – a cég nem lett törölve.");
    await wipeCompanyData(cid);
    await db.delete(schema.companies).where(eq(schema.companies.id, cid));
    return `/?ok=${encodeURIComponent(`„${m.name}” véglegesen törölve.`)}`;
  });
}
