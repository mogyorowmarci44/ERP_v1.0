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

/** Az ERP saját jele: keret nélküli pálcák (oszlopdiagram) borostyán alapvonallal, fölöttük ívelt, emelkedő vonal ponttal. */
export function ErpMark({ size = 32, dark = false }: { size?: number; dark?: boolean }) {
  const bar = dark ? "#1D9E75" : "#5DCAA5";
  const mid = dark ? "#0F6E56" : "#9FE1CB";
  const last = dark ? "#5DCAA5" : "#1D9E75";
  const line = dark ? "#E1F5EE" : "#0F6E56";
  const small = size <= 20; // kis méretben vastagabb vonalak
  const w = small ? 3.5 : 3;
  return (
    <svg className="erp-mark" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <rect x="9" y="17" width={w} height="18" rx="1.5" fill={bar} />
      <rect x="15.5" y="22" width={w} height="13" rx="1.5" fill={bar} />
      <rect x="20.5" y="25" width={w} height="10" rx="1.5" fill={mid} />
      <rect x="25.5" y="20" width={w} height="15" rx="1.5" fill={bar} />
      <rect x="32" y="13" width={w} height="22" rx="1.5" fill={last} />
      <rect x="5" y="37.5" width="34" height={small ? 2.5 : 2} rx="1" fill="#EF9F27" />
      <path d="M10.5 12.5 C 14 14.5, 18.5 21.5, 22 21.5 C 25.5 21.5, 29 13, 33.5 8.5" fill="none" stroke={line} strokeWidth={small ? 3 : 2.4} strokeLinecap="round" />
      <circle cx="33.5" cy="8.5" r={small ? 3 : 2.4} fill="#EF9F27" />
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
export function AppFooter({ company, version, dark, darkMark }: { company?: string; version: string; dark?: boolean; darkMark?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={dark ? "app-footer dark" : "app-footer"}>
      <span className="af-brand">
        <ErpMark size={16} dark={dark || darkMark} />
        Mogyorosi Holding™ · © {year}
      </span>
      <span>
        {company && <>Aktív cég: <span className="af-strong">{company}</span> · </>}v{version}
        {" · "}<a href="/jogi/aszf">ÁSZF</a>{" · "}<a href="/jogi/adatkezeles">Adatkezelés</a>
      </span>
    </footer>
  );
}

/** Védjegy-sor nyomtatható dokumentumok (karton, kölcsönokiratok) aljára – minden lapon. */
export function DocMark() {
  return (
    <div className="doc-mark">
      <ErpMark size={12} />
      Mogyorosi Holding™ · mogyorosi.erp
    </div>
  );
}
