import Link from "next/link";
import { HELP } from "@/lib/help";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const metadata = { title: "Súgó – mogyorosi.erp" };

/** v6.12.0 – Súgó: modulonként rövid, gyakorlati leírás. */
export default function HelpPage() {
  return (
    <div className="main" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}><ErpLogo size={28} /><h1>Súgó</h1></div>
        <div className="row"><Link href="/ujdonsagok">Újdonságok</Link><Link className="btn" href="/">Cégeim</Link></div>
      </div>
      <nav className="card help-toc">
        {HELP.map((h) => <a key={h.id} href={`#${h.id}`}>{h.title}</a>)}
      </nav>
      {HELP.map((h) => (
        <section key={h.id} id={h.id} className="card help-section">
          <h2>{h.title}</h2>
          {h.body.map((p, i) => <p key={i}>{p}</p>)}
        </section>
      ))}
      <p className="muted">Nem találod, amit keresel? Írj a könyvelődnek vagy az üzemeltetőnek – a hibákat a rendszer automatikusan naplózza.</p>
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
