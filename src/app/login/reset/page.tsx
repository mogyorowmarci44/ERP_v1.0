import Link from "next/link";
import { resetPasswordAction } from "../../auth-actions";
import { peekUserToken } from "@/lib/user-tokens";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** v6.0.0 – Új jelszó beállítása linkkel: jelszó-visszaállítás vagy meghívó elfogadása. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const t = sp.t ?? "";
  const r = await peekUserToken(t);
  const invite = r ? r.token.purpose === "invite" : sp.invite === "1";
  return (
    <div className="auth-wrap">
      <div className="auth card">
        <ErpLogo />
        <h1>{invite ? "Fiók aktiválása" : "Új jelszó"}</h1>
        <Flash error={sp.error} />
        {r ? (
          <>
            <p className="muted">{invite ? `Üdv, ${r.user.name}! Állítsd be a jelszavad` : "Add meg az új jelszavad"} ({r.user.email}). Legalább 10 karakter.</p>
            <form action={resetPasswordAction}>
              <input type="hidden" name="t" value={t} />
              {invite && <input type="hidden" name="invite" value="1" />}
              <input type="text" name="username" autoComplete="username" defaultValue={r.user.email} hidden readOnly />
              <label>Új jelszó<input name="password" type="password" minLength={10} autoComplete="new-password" required autoFocus /></label>
              <label>Új jelszó még egyszer<input name="password2" type="password" minLength={10} autoComplete="new-password" required /></label>
              <button className="primary">{invite ? "Aktiválás" : "Jelszó beállítása"}</button>
            </form>
          </>
        ) : (
          <p>A link lejárt vagy már fel lett használva. {invite ? "Kérj új meghívót az ügyfélfiókod adminjától." : <Link href="/login/forgot">Kérj új linket.</Link>}</p>
        )}
        <p style={{ marginTop: 12, fontSize: 14 }}><Link href="/login">← Belépés</Link></p>
      </div>
      <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
