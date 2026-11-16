import { monogram } from "@/lib/themes";

/** EU-s rendszámtábla mintájú jelvény a cég monogramjával. */
export function Plate({ text, title }: { text: string; title?: string }) {
  return (
    <span className="plate" title={title} aria-label={title ?? text}>
      <span className="eu" aria-hidden="true"><span className="stars" />H</span>
      <span className="txt">{text}</span>
    </span>
  );
}

export function CompanyMark({ id, name, logoVersion }: { id: number; name: string; logoVersion: number | null }) {
  if (logoVersion) {
    return (
      <span className="logo-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/logo/${id}?v=${logoVersion}`} alt={`${name} logó`} />
      </span>
    );
  }
  return <Plate text={monogram(name)} title={name} />;
}

/** Az ERP saját jele: oszlopokból (főkönyvi sorokból) kirakott „M”. */
export function ErpMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="erp-mark" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="40" height="40" rx="8" fill="#04342C" />
      <rect x="9" y="14" width="5" height="21" rx="1" fill="#5DCAA5" />
      <rect x="16" y="22" width="5" height="13" rx="1" fill="#9FE1CB" />
      <rect x="23" y="22" width="5" height="13" rx="1" fill="#9FE1CB" />
      <rect x="30" y="10" width="5" height="25" rx="1" fill="#5DCAA5" />
    </svg>
  );
}

/** Teljes logó: jel + „mogyorosi.erp” szóvédjegy. */
export function ErpLogo({ size = 36, sub }: { size?: number; sub?: string }) {
  return (
    <span className="erp-logo" role="img" aria-label="mogyorosi.erp">
      <ErpMark size={size} />
      <span className="erp-word">
        <span className="erp-name">mogyorosi<span className="erp-dot">.erp</span></span>
        {sub && <span className="erp-sub">{sub}</span>}
      </span>
    </span>
  );
}

/** Minden oldal alján megjelenő védjegy-lábléc (Mogyorosi Holding™). */
export function AppFooter({ company, version, dark }: { company?: string; version: string; dark?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={dark ? "app-footer dark" : "app-footer"}>
      <span className="af-brand">
        <ErpMark size={16} />
        Mogyorosi Holding™ · © {year}
      </span>
      <span>
        {company && <>Aktív cég: <span className="af-strong">{company}</span> · </>}v{version}
      </span>
    </footer>
  );
}
