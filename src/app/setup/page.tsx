import { redirect } from "next/navigation";
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setupAction } from "../auth-actions";
import { Flash } from "@/components/Flash";
import { Plate } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.users);
  if (n > 0) redirect("/login");
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
    <div className="auth card">
      <Plate text="ERP" title="MM ERP" />
      <h1>Első indítás</h1>
      <p className="muted">Hozd létre az adminisztrátor felhasználót.</p>
      <Flash error={sp.error} />
      <form action={setupAction}>
        <label>Név<input name="name" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <label>Jelszó (min. 10 karakter)<input name="password" type="password" minLength={10} required /></label>
        <button className="primary">Létrehozás</button>
      </form>
    </div>
    </div>
  );
}
