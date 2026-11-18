"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { setMfaRequired } from "@/lib/app-settings";

const { users, memberships } = schema;
const ROLES = new Set(["owner", "accountant", "viewer"]);
const ok = (msg: string) => `/admin?ok=${encodeURIComponent(msg)}`;

/** Hozzáférés beállítása egy felhasználónak egy céghez: szerepkör megadása / módosítása, vagy „none” = elvétel. */
export async function setAccessAction(fd: FormData) {
  await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const userId = Number(fd.get("userId"));
    const companyId = Number(fd.get("companyId"));
    const role = str(fd, "role");
    if (!userId || !companyId) throw new Error("Hiányzó felhasználó vagy cég.");
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
    revalidatePath("/admin");
    return ok(role === "none" ? "Hozzáférés megvonva." : "Hozzáférés mentve.");
  });
}

/** Elveszett telefon esetén: a felhasználó 2FA-ja törlődik, minden munkamenete kilép, a következő belépéskor újra beállítja. */
export async function resetMfaAction(fd: FormData) {
  const admin = await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const userId = Number(fd.get("userId"));
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
  await requireAdmin();
  await runOrRedirect("/admin", async () => {
    const on = fd.get("on") === "1";
    await setMfaRequired(on);
    revalidatePath("/admin");
    // bekapcsoláskor a csak jelszóval szerzett munkamenetek érvénytelenné válnak – ha az adminé is ilyen, újra be kell lépnie
    return on ? "/admin?ok=" + encodeURIComponent("Kétlépcsős azonosítás bekapcsolva – mindenkinek kötelező.") : "/admin?ok=" + encodeURIComponent("Kétlépcsős azonosítás kikapcsolva – a belépéshez elég a jelszó.");
  });
}
