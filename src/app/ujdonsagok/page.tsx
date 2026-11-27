import Link from "next/link";
import { CHANGELOG } from "@/lib/changelog";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { MarkSeen } from "./MarkSeen";

export const metadata = { title: "Újdonságok – mogyorosi.erp" };

/** v6.12.0 – Újdonságok: verziónként, közérthetően. */
export default function NewsPage() {
  return (
    <div className="main" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}><ErpLogo size={28} /><h1>Újdonságok</h1></div>
        <div className="row"><Link href="/sugo">Súgó</Link><Link className="btn" href="/">Cégeim</Link></div>
      </div>
      {CHANGELOG.map((r) => (
        <section key={r.version} className="card help-section">
          <h2>{r.title} <span className="version-tag">v{r.version}</span></h2>
          <ul>{r.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
        </section>
      ))}
      <MarkSeen />
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
