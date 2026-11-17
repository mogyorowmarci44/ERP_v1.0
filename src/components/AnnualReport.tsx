/** Éves beszámoló nyomtatható A4 lapjai: fedlap, mérleg, eredménykimutatás, kiegészítő melléklet. */
import type { AnnualReportMeta, AnnualSection, AnnualStatement } from "@/lib/annual-report";
import { inlineParts, isNumCell, parseBlocks } from "@/lib/annual-text";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { DocMark } from "@/components/Brand";

export type AnnualCompany = { name: string; address: string | null; taxNumber: string | null; registrationNumber: string | null };

const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
export const longDate = (d: string | null | undefined) => (d ? `${d.slice(0, 4)}. ${HU_MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.` : "");
const periodText = (m: AnnualReportMeta) => `${longDate(m.periodFrom)} – ${longDate(m.periodTo)}`;

function Inline({ s }: { s: string }) {
  return <>{inlineParts(s).map((p, i) => (p.b ? <strong key={i}>{p.s}</strong> : <span key={i}>{p.s}</span>))}</>;
}

function Head({ company, meta, title }: { company: AnnualCompany; meta: AnnualReportMeta; title: string }) {
  return (
    <header className="mc-head">
      <div>
        <div className="mc-company">{company.name}</div>
        <div className="mc-sub">
          {[company.address, company.registrationNumber ? `Cg. ${company.registrationNumber}` : null, company.taxNumber ? `adószám: ${company.taxNumber}` : null, meta.statNumber ? `stat. számjel: ${meta.statNumber}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="mc-title">
        <h1>{title}</h1>
        <div className="mc-sub">{meta.kind} · {periodText(meta)}</div>
        {meta.versionLabel ? <div className="mc-sub ar-version">{meta.versionLabel}</div> : null}
      </div>
    </header>
  );
}

function Sign({ meta, printedAt }: { meta: AnnualReportMeta; printedAt: string }) {
  return (
    <footer className="mc-foot mc-end">
      <div className="mc-sign">
        <span>Kelt: {[meta.preparedPlace, longDate(meta.preparedAt)].filter(Boolean).join(", ") || "……………………"}</span>
      </div>
      <div className="mc-sign">
        <span>{meta.signer ?? "……………………"}</span>
        <div>{meta.signerTitle ?? "a vállalkozás vezetője (képviselője)"}</div>
      </div>
      <div className="mc-meta">Készült: {printedAt} · mogyorosi.erp</div>
      <div className="ar-docmark"><DocMark /></div>
    </footer>
  );
}

const Amt = ({ v }: { v: number }) => (Math.abs(v) < 0.5 ? <span className="muted">–</span> : <>{fmtHuf(v)}</>);

function StatementSheet({ s, company, meta, printedAt, note }: { s: AnnualStatement; company: AnnualCompany; meta: AnnualReportMeta; printedAt: string; note?: string }) {
  let n = 0;
  return (
    <section className="mc-sheet ar-sheet">
      <Head company={company} meta={meta} title={s.title} />
      <p className="mc-note">Adatok forintban. {note}{s.rows.some((r) => r.cells.includes(null)) ? " „n.a.”: a közzétett beszámoló ezt a sort külön nem tartalmazta." : ""}</p>
      <table className="mc-table ar-statement">
        <thead>
          <tr>
            <th className="ar-no">Sor</th>
            <th>A tétel megnevezése</th>
            {s.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key} className={`ar-${r.kind}${r.indent ? " ar-sub" : ""}`}>
              <td className="ar-no">{String(++n).padStart(2, "0")}.</td>
              <td className={r.indent ? "ar-indent" : undefined}>{r.label}</td>
              {r.cells.map((v, i) => (
                <td key={i} className={`num${s.cols[i].key === "diff" && v !== null && Math.abs(v) >= 0.5 ? " ar-diff" : ""}`}>
                  {v === null ? <span className="muted">n.a.</span> : <>{s.cols[i].key === "diff" && v > 0.5 ? "+" : ""}<Amt v={v} /></>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!s.checkOk && <p className="mc-checks"><span className="warn">⚠ A kimutatás nem egyezik (eszközök ≠ források) – nézd meg a főkönyvi kivonatot.</span></p>}
      <Sign meta={meta} printedAt={printedAt} />
    </section>
  );
}

export function AnnualCover({ company, meta, figures, printedAt }: { company: AnnualCompany; meta: AnnualReportMeta; figures: Record<string, number>; printedAt: string }) {
  return (
    <section className="mc-sheet ar-sheet ar-cover">
      <div className="ar-cover-id">
        <dl>
          <dt>Cégjegyzékszám</dt><dd>{company.registrationNumber ?? "–"}</dd>
          <dt>Adószám</dt><dd>{company.taxNumber ?? "–"}</dd>
          <dt>Statisztikai számjel</dt><dd>{meta.statNumber ?? "–"}</dd>
        </dl>
      </div>
      <div className="ar-cover-main">
        <div className="ar-cover-name">{company.name}</div>
        <div className="mc-sub">{company.address}</div>
        <h1>{meta.kind}</h1>
        <div className="ar-cover-period">{periodText(meta)}</div>
        <div className="mc-sub">Mérlegfordulónap: {longDate(meta.periodTo)}</div>
        {meta.versionLabel ? <div className="ar-version ar-cover-version">{meta.versionLabel}</div> : null}
      </div>
      <table className="mc-calc ar-cover-fig">
        <tbody>
          <tr><td>Mérlegfőösszeg</td><td className="num">{fmtHuf(figures.total)} Ft</td></tr>
          <tr><td>Saját tőke</td><td className="num">{fmtHuf(figures.equity)} Ft</td></tr>
          <tr><td>Értékesítés nettó árbevétele</td><td className="num">{fmtHuf(figures.revenue)} Ft</td></tr>
          <tr><td>Adózás előtti eredmény</td><td className="num">{fmtHuf(figures.pbt)} Ft</td></tr>
          <tr className="sum"><td>Adózott eredmény</td><td className="num">{fmtHuf(figures.net)} Ft</td></tr>
        </tbody>
      </table>
      <div className="ar-cover-parts">
        <div>Részei: 1. Mérleg („A” változat) · 2. Eredménykimutatás (összköltség-eljárás, „A” változat) · 3. Kiegészítő melléklet</div>
        {meta.preparer ? <div>A beszámolót összeállította: {meta.preparer}{meta.preparerRegNo ? ` (nyilvántartási szám: ${meta.preparerRegNo})` : ""}</div> : null}
        {meta.filed ? <div>Eredetileg közzétett változat: {meta.filed.label ?? "–"}{meta.filed.date ? ` (${fmtDate(meta.filed.date)})` : ""}</div> : null}
      </div>
      <Sign meta={meta} printedAt={printedAt} />
    </section>
  );
}

export function AnnualStatements({ balance, income, company, meta, printedAt }: { balance: AnnualStatement; income: AnnualStatement; company: AnnualCompany; meta: AnnualReportMeta; printedAt: string }) {
  const note = meta.filed ? "A „Helyesbítés” oszlop a kiegészítő mellékletben tételesen bemutatott hibák összevont hatása." : "";
  return (
    <>
      <StatementSheet s={balance} company={company} meta={meta} printedAt={printedAt} note={`Mérlegfordulónap: ${longDate(meta.periodTo)} ${note}`} />
      <StatementSheet s={income} company={company} meta={meta} printedAt={printedAt} note={`Összköltség-eljárással készített eredménykimutatás. ${note}`} />
    </>
  );
}

export function AnnualNotes({ sections, company, meta, printedAt }: { sections: AnnualSection[]; company: AnnualCompany; meta: AnnualReportMeta; printedAt: string }) {
  return (
    <section className="mc-sheet ar-sheet ar-notes">
      <Head company={company} meta={meta} title="Kiegészítő melléklet" />
      {sections.length === 0 && <p className="muted">Még nincs kiegészítő melléklet ehhez az évhez.</p>}
      {sections.map((s, i) => (
        <div key={i} className="ar-section">
          <h2>{s.no ? `${s.no} ` : ""}{s.title}</h2>
          {parseBlocks(s.body).map((b, k) => {
            if (b.t === "p") return <p key={k}><Inline s={b.text} /></p>;
            if (b.t === "h") return <h3 key={k}>{b.text}</h3>;
            if (b.t === "ul") return <ul key={k}>{b.items.map((x, j) => <li key={j}><Inline s={x} /></li>)}</ul>;
            // Számoszlop: a nem üres cellák legalább 60%-a szám → jobbra igazítva (az első oszlop mindig szöveg)
            const width = Math.max(b.head?.length ?? 0, ...b.rows.map((r) => r.length));
            const numCol = Array.from({ length: width }, (_, j) => {
              if (j === 0) return false;
              const cs = b.rows.map((r) => (r[j] ?? "").replace(/\*\*/g, "").trim()).filter(Boolean);
              return cs.length > 0 && cs.filter(isNumCell).length / cs.length >= 0.6;
            });
            return (
              <table key={k} className="mc-table ar-table">
                {b.head && <thead><tr>{b.head.map((h, j) => <th key={j} className={numCol[j] ? "num" : undefined}>{h}</th>)}</tr></thead>}
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className={r[0]?.startsWith("**") ? "ar-total" : undefined}>
                      {r.map((c, m) => <td key={m} className={numCol[m] ? "num" : undefined}><Inline s={c} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
        </div>
      ))}
      <Sign meta={meta} printedAt={printedAt} />
    </section>
  );
}
