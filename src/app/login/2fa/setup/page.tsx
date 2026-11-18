import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getPendingMfa } from "@/lib/auth";
import { otpauthUri } from "@/lib/totp";
import { confirmMfaSetupAction, cancelMfaAction } from "../../../auth-actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const p = await getPendingMfa();
  if (!p) redirect("/login");
  if (p.pending.stage !== "setup") redirect("/login/2fa");
  const { secret, codes } = p.pending;
  const sp = await searchParams;
  const svg = await QRCode.toString(otpauthUri(secret, p.user.email), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const grouped = secret.match(/.{1,4}/g)!.join(" ");

  return (
    <div className="auth-wrap">
      <div className="auth card" style={{ maxWidth: 520 }}>
        <ErpLogo />
        <h1>Kétlépcsős azonosítás beállítása</h1>
        <p className="muted">
          Az ERP-be ezentúl a jelszó mellett a telefonodon lévő hitelesítő alkalmazás kódjával lehet belépni. Ezt egyszer kell beállítani.
        </p>
        <Flash error={sp.error} />

        <h2 style={{ fontSize: 16, marginBottom: 6 }}>1. Olvasd be a QR-kódot</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Google Authenticator, Microsoft Authenticator, 1Password, Authy … → „Fiók hozzáadása” → QR-kód beolvasása.
        </p>
        <div style={{ display: "grid", placeItems: "center" }}>
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <details className="fc-more" style={{ marginTop: 8 }}>
          <summary>Nem tudom beolvasni – kézi kulcs</summary>
          <p style={{ fontFamily: "monospace", fontSize: 15, wordBreak: "break-all" }}>{grouped}</p>
          <p className="muted" style={{ fontSize: 13 }}>Típus: időalapú (TOTP), 6 jegy, 30 mp.</p>
        </details>

        <h2 style={{ fontSize: 16, marginBottom: 6 }}>2. Mentsd el a tartalékkódokat</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Ha elveszik a telefon, ezekkel tudsz belépni (mindegyik egyszer). Most látod őket utoljára – írd fel vagy mentsd jelszókezelőbe.
        </p>
        <ol style={{ columns: 2, fontFamily: "monospace", fontSize: 15, margin: "0 0 12px", paddingLeft: 28 }}>
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ol>

        <h2 style={{ fontSize: 16, marginBottom: 6 }}>3. Írd be az alkalmazás kódját</h2>
        <form action={confirmMfaSetupAction}>
          <label>6 jegyű kód
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required placeholder="123456" style={{ fontSize: 22, letterSpacing: 4, textAlign: "center" }} />
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="saved" required style={{ width: "auto" }} /> Elmentettem a tartalékkódokat
          </label>
          <button className="primary">Bekapcsolás és belépés</button>
        </form>
        <p className="muted" style={{ fontSize: 12 }}>10 perced van a beállításra, utána újra meg kell adnod a jelszót (új QR-kódot kapsz).</p>
        <form action={cancelMfaAction}><button className="link">Mégse</button></form>
      </div>
      <AppFooter version={APP_VERSION} dark />
    </div>
  );
}
