import { redirect } from "next/navigation";
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setupAction } from "../auth-actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.users);
  if (n > 0) redirect("/login");
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
    <div className="auth card">
      <ErpLogo />
      <h1>Első indítás</h1>
      <p className="muted">Hozd létre az adminisztrátor felhasználót.</p>
      <Flash error={sp.error} />
      <form action={setupAction}>
        <label>Ügyfélfiók neve<input name="orgName" required placeholder="pl. a cégcsoport vagy könyvelőiroda neve" /></label>
        <label>Név<input name="name" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <label>Jelszó (min. 10 karakter)<input name="password" type="password" minLength={10} required /></label>
        <label className="check"><input type="checkbox" name="terms" required /> Elfogadom az <a href="/jogi/aszf" target="_blank">ÁSZF</a>-et (és az <a href="/jogi/adatfeldolgozas" target="_blank">adatfeldolgozói szerződést</a>), és megismertem az <a href="/jogi/adatkezeles" target="_blank">adatkezelési tájékoztatót</a>.</label>
        <button className="primary">Létrehozás</button>
      </form>
    </div>
    <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
