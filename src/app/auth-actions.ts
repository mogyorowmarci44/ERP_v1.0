"use server";

import { redirect } from "next/navigation";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession, destroySession, hashPassword, verifyPassword, requireUser } from "@/lib/auth";
import { createCompany } from "@/lib/ledger";
import { taxProfileFromForm } from "@/lib/entity";
import { wipeCompanyData } from "@/lib/importer";
import { runOrRedirect, str, optStr } from "@/lib/action-utils";

export async function loginAction(fd: FormData) {
  await runOrRedirect("/login", async () => {
    const email = str(fd, "email").toLowerCase();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!u || !(await verifyPassword(str(fd, "password"), u.passwordHash))) throw new Error("Hibás e-mail cím vagy jelszó.");
    await createSession(u.id);
    return "/";
  });
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
    await createSession(u.id);
    return "/";
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
    await db.update(schema.users).set({ passwordHash: await hashPassword(pw) }).where(eq(schema.users.id, user.id));
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
