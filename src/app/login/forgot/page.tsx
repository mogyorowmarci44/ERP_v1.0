import Link from "next/link";
import { forgotPasswordAction } from "../../auth-actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** v6.0.0 – Elfelejtett jelszó: visszaállító link e-mailben (1 óráig érvényes). */
export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
      <div className="auth card">
        <ErpLogo />
        <h1>Elfelejtett jelszó</h1>
        <p className="muted">Add meg a belépéshez használt e-mail címed – küldünk egy linket, amellyel új jelszót állíthatsz be.</p>
        <Flash error={sp.error} />
        <form action={forgotPasswordAction}>
          <label>E-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
          <button className="primary">Link küldése</button>
        </form>
        <p style={{ marginTop: 12, fontSize: 14 }}><Link href="/login">← Vissza a belépéshez</Link></p>
      </div>
      <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
