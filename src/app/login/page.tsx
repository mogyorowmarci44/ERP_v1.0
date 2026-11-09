import { redirect } from "next/navigation";
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loginAction } from "../auth-actions";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.users);
  if (n === 0) redirect("/setup");
  const sp = await searchParams;
  return (
    <div className="auth card">
      <h1>MM ERP – belépés</h1>
      <Flash error={sp.error} />
      <form action={loginAction}>
        <label>E-mail<input name="email" type="email" required autoFocus /></label>
        <label>Jelszó<input name="password" type="password" required /></label>
        <button className="primary">Belépés</button>
      </form>
    </div>
  );
}
