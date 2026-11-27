import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { globalSearch, PER_KIND, type Hit } from "@/lib/search";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const metadata = { title: "Keresés – mogyorosi.erp" };
const KIND: Record<Hit["kind"], string> = { invoice: "Számlák", partner: "Partnerek", entry: "Naplótételek", vehicle: "Gépkocsik" };

/** v7.4.0 – Globális kereső az összes elérhető cégben. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const qs = (sp.q ?? "").trim();
  const back = sp.from && /^\/c\/\d+/.test(sp.from) ? sp.from : "/";
  const r = qs.length >= 2 ? await globalSearch(user.id, qs) : null;
  const kinds = (Object.keys(KIND) as Hit["kind"][]).filter((k) => r?.hits.some((h) => h.kind === k));
  return (
    <div className="main" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}><ErpLogo size={28} /><h1>Keresés</h1></div>
        <Link className="btn" href={back}>← Vissza</Link>
      </div>
      <form className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input name="q" defaultValue={qs} autoFocus placeholder="Számlaszám, partner, adószám, összeg, naplószám, rendszám, alvázszám…" style={{ flex: 1, minWidth: 240 }} />
        {sp.from && <input type="hidden" name="from" value={sp.from} />}
        <button className="primary">Keresés</button>
      </form>
      {qs.length > 0 && qs.length < 2 && <p className="muted">Legalább 2 karaktert adj meg.</p>}
      {r && (
        <p className="muted" style={{ marginTop: -6 }}>
          {r.hits.length ? `${r.hits.length} találat` : "Nincs találat"} · {r.companies} cégben keresve{r.hits.length ? ` · típusonként legfeljebb ${PER_KIND}` : ""}
        </p>
      )}
      {kinds.map((k) => (
        <section key={k} className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>{KIND[k]}</h2>
          <ul className="search-hits">
            {r!.hits.filter((h) => h.kind === k).map((h, i) => (
              <li key={i}>
                <Link href={h.href}><strong>{h.title}</strong></Link>
                <div className="muted" style={{ fontSize: 13 }}>{h.detail}{r!.companies > 1 && <> · <em>{h.companyName}</em></>}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
