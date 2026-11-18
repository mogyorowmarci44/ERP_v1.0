import { redirect } from "next/navigation";
import { getPendingMfa } from "@/lib/auth";
import { verifyMfaAction, cancelMfaAction } from "../../auth-actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const p = await getPendingMfa();
  if (!p) redirect("/login");
  if (p.pending.stage === "setup") redirect("/login/2fa/setup");
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
      <div className="auth card">
        <ErpLogo />
        <h1>Kétlépcsős azonosítás</h1>
        <p className="muted">Add meg a hitelesítő alkalmazásban (pl. Google / Microsoft Authenticator) látható 6 jegyű kódot.</p>
        <Flash error={sp.error} />
        <form action={verifyMfaAction}>
          <label>Kód
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}" maxLength={11} required autoFocus placeholder="123456" style={{ fontSize: 22, letterSpacing: 4, textAlign: "center" }} />
          </label>
          <button className="primary">Belépés</button>
        </form>
        <details className="fc-more" style={{ marginTop: 12 }}>
          <summary>Nincs nálam a telefon</summary>
          <p className="muted" style={{ fontSize: 13 }}>
            A kód helyére beírhatod az egyik tartalékkódot (xxxxx-xxxxx) – mindegyik egyszer használható.
            Ha egyik sincs meg, az adminisztrátor az Admin oldalon visszaállíthatja a 2FA-t, és újra beállíthatod.
          </p>
        </details>
        <form action={cancelMfaAction} style={{ marginTop: 8 }}>
          <button className="link">Vissza a bejelentkezéshez</button>
        </form>
      </div>
      <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
