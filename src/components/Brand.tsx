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
