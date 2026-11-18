import Link from "next/link";

/** ÁFA: az ÁFA analitika és a különbözeti ÁFA kartonok egy helyen, fülekkel. */
export function VatTabs({ cid, active }: { cid: number; active: "vat" | "margin" | "closing" }) {
  return (
    <nav className="tabs no-print" aria-label="ÁFA">
      <Link href={`/c/${cid}/reports/vat`} className={active === "vat" ? "on" : undefined}>ÁFA analitika</Link>
      <Link href={`/c/${cid}/vehicles/kartonok`} className={active === "margin" ? "on" : undefined}>Különbözeti ÁFA kartonok</Link>
      <Link href={`/c/${cid}/reports/vat/closing`} className={active === "closing" ? "on" : undefined}>ÁFA-zárás</Link>
    </nav>
  );
}
