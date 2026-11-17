import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { defaultMeta, getAnnualReport, sectionsToText } from "@/lib/annual-report";
import { Flash } from "@/components/Flash";
import { today } from "@/lib/dates";
import { saveAnnualReportAction } from "../actions";

const TEMPLATE = `## 1. Általános rész

A társaság neve, székhelye, tevékenysége, tulajdonosai…

## 2. A számviteli politika főbb elemei

…

## 3. A mérleghez kapcsolódó kiegészítések

| Tétel | Összeg (Ft) |
|---|---|
| Készletek | 0 |

## 4. Az eredménykimutatáshoz kapcsolódó kiegészítések

…

## 5. Egyéb kiegészítések

…`;

/** Kiegészítő melléklet szerkesztő – egyszerű jelölés: „## ” fejezet, „### ” alcím, „- ” felsorolás, „| a | b |” táblázat, **félkövér**. */
export default async function AnnualEditPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { write: true });
  const year = Number(sp.year) || Number(today().slice(0, 4)) - 1;
  const rep = await getAnnualReport(cid, year);
  const m = rep?.meta ?? { ...defaultMeta(year), signer: company.settings?.representative ?? null, signerTitle: company.settings?.representativeTitle ?? "ügyvezető" };
  const F = ({ name, label, value, type = "text", ph }: { name: string; label: string; value?: string | null; type?: string; ph?: string }) => (
    <label>{label}<input name={name} type={type} defaultValue={value ?? ""} placeholder={ph} /></label>
  );
  return (
    <div className="ar-editor">
      <div className="topbar">
        <h1>Kiegészítő melléklet – {year}</h1>
        <div className="row"><Link className="btn" href={`/c/${cid}/reports/annual?year=${year}`}>← Beszámoló</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={saveAnnualReportAction} className="card" style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="cid" value={cid} />
        <input type="hidden" name="year" value={year} />
        <div className="grid2">
          <F name="kind" label="Beszámoló formája" value={m.kind} />
          <F name="versionLabel" label="Változat megjelölése" value={m.versionLabel} ph="pl. Helyesbített változat" />
          <F name="periodFrom" label="Időszak kezdete" type="date" value={m.periodFrom} />
          <F name="periodTo" label="Mérlegfordulónap" type="date" value={m.periodTo} />
          <F name="statNumber" label="Statisztikai számjel" value={m.statNumber} />
          <F name="preparedPlace" label="Keltezés helye" value={m.preparedPlace} />
          <F name="preparedAt" label="Keltezés dátuma" type="date" value={m.preparedAt} />
          <F name="signer" label="Aláíró (képviselő)" value={m.signer} />
          <F name="signerTitle" label="Beosztása" value={m.signerTitle} />
          <F name="preparer" label="Összeállította" value={m.preparer} />
          <F name="preparerRegNo" label="Mérlegképes reg. szám" value={m.preparerRegNo} />
        </div>
        <label>Kiegészítő melléklet
          <span className="muted">„## 1. Cím” = fejezet · „### ” alcím · „- ” felsorolás · „| a | b |” táblázat (2. sor „|---|---|” → fejléc) · **félkövér**</span>
          <textarea name="notes" defaultValue={rep ? sectionsToText(rep.sections) : TEMPLATE} />
        </label>
        <details>
          <summary>Eredetileg közzétett adatok (helyesbített beszámolóhoz)</summary>
          <p className="muted">JSON: {`{"label": "Közzétett 2025", "date": "2026-05-31", "bs": {"BI": 7245076, …}, "pnl": {"I": 16614476, …}}`} – a sorkulcsok a Kimutatások mérleg/EK sorai (A, AI, BI, BIV, D, DI, DVII, F, FIII, ASSETS, LIABEQ; I, III, IV, IV5…IV9, VI, VII, A, B, C, X, D). Üresen hagyva csak a tárgyévi oszlop jelenik meg.</p>
          <textarea name="filed" style={{ minHeight: 120 }} defaultValue={m.filed ? JSON.stringify(m.filed, null, 1) : ""} />
        </details>
        <div className="row"><button className="primary">Mentés</button></div>
      </form>
    </div>
  );
}
