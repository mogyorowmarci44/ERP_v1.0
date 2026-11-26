import { redirect } from "next/navigation";
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loginAction } from "../auth-actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.users);
  if (n === 0) redirect("/setup");
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
    <div className="auth card">
      <ErpLogo />
      <h1>Belépés</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={loginAction}>
        <label>E-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label>Jelszó<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="primary">Belépés</button>
      </form>
      <p style={{ marginTop: 12, fontSize: 14 }}><a href="/login/forgot">Elfelejtett jelszó?</a></p>
    </div>
    <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
