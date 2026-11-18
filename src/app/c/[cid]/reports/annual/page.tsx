import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { annualStatements, defaultMeta, getAnnualReport, listAnnualYears } from "@/lib/annual-report";
import { AnnualCover, AnnualNotes, AnnualStatements } from "@/components/AnnualReport";
import { PrintButton } from "@/components/PrintButton";
import { Flash } from "@/components/Flash";
import { today } from "@/lib/dates";

/** Éves beszámoló: fedlap + mérleg + eredménykimutatás (főkönyvből) + kiegészítő melléklet (szerkeszthető szöveg). */
export default async function AnnualReportPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const stored = await listAnnualYears(cid);
  const cur = Number(today().slice(0, 4));
  const year = Number(sp.year) || stored[0] || cur - 1;
  const rep = await getAnnualReport(cid, year);
  const meta = rep?.meta ?? defaultMeta(year);
  const { balance, income, figures } = await annualStatements(cid, meta, company.fiscalYearStartMonth);
  const printedAt = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  const years = Array.from(new Set([...stored, cur, cur - 1, cur - 2])).sort((a, b) => b - a);
  const part = sp.part === "notes" || sp.part === "statements" ? sp.part : "all";
  const co = { name: company.name, address: company.address, taxNumber: company.taxNumber, registrationNumber: company.registrationNumber };
  return (
    <>
      <div className="topbar no-print">
        <h1>Éves beszámoló – {year}</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/closing`}>← Évzárás</Link>
          {role !== "viewer" && <Link className="btn" href={`/c/${cid}/reports/annual/edit?year=${year}`}>Kiegészítő melléklet szerkesztése</Link>}
          <PrintButton label="Nyomtatás / PDF" />
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Üzleti év<select name="year" defaultValue={year}>{years.map((y) => <option key={y} value={y}>{y}{stored.includes(y) ? " ✓" : ""}</option>)}</select></label>
        <label>Tartalom
          <select name="part" defaultValue={part}>
            <option value="all">Teljes beszámoló</option>
            <option value="statements">Csak mérleg és EK</option>
            <option value="notes">Csak kiegészítő melléklet</option>
          </select>
        </label>
        <button style={{ alignSelf: "end" }}>Megjelenítés</button>
        <span className="muted" style={{ alignSelf: "end" }}>
          {rep ? `Melléklet: ${rep.sections.length} fejezet · módosítva ${rep.updatedAt.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}` : "Ehhez az évhez még nincs kiegészítő melléklet – a számok a főkönyvből jönnek."}
          {meta.filed ? " · közzétett / helyesbítés / helyesbített oszlopokkal" : ""}
        </span>
      </form>
      {part === "all" && <AnnualCover company={co} meta={meta} figures={figures} printedAt={printedAt} />}
      {part !== "notes" && <AnnualStatements balance={balance} income={income} company={co} meta={meta} printedAt={printedAt} />}
      {part !== "statements" && <AnnualNotes sections={rep?.sections ?? []} company={co} meta={meta} printedAt={printedAt} />}
    </>
  );
}
