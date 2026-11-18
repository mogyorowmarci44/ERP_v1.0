"use client";

import { useState, useTransition } from "react";
import { deltaImportAction } from "@/app/c/[cid]/actions";
import type { DeltaReport } from "@/lib/delta-import";
import { fmtHuf } from "@/lib/money";

const KIND: Record<string, string> = { entry: "Vegyes tétel", invoice: "Számla", payment: "Kiegyenlítés", reversal: "Storno", asset: "Tárgyi eszköz", depreciation: "ÉCS" };

/** Kiegészítő csomag: fájl → előnézet (visszagörgetett próbafutás) → betöltés. */
export function DeltaImportForm({ cid }: { cid: number }) {
  const [file, setFile] = useState<{ name: string; json: string; note?: string } | null>(null);
  const [report, setReport] = useState<DeltaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (apply: boolean, f = file) =>
    start(async () => {
      if (!f) return;
      setError(null);
      const r = await deltaImportAction(cid, f.json, f.name, apply);
      if (r.error) { setError(r.error); setReport(null); return; }
      setReport(r.report!);
    });

  const onFile = async (f: File | undefined) => {
    setReport(null); setError(null); setFile(null);
    if (!f) return;
    const json = await f.text();
    let note: string | undefined;
    try { note = JSON.parse(json)?.note; } catch { /* a szerver jelzi */ }
    const next = { name: f.name, json, note };
    setFile(next);
    run(false, next);
  };

  const errors = report?.results.filter((r) => r.status === "error").length ?? 0;
  const news = report?.results.filter((r) => r.status === "new").length ?? 0;
  const skips = report?.results.filter((r) => r.status === "skip").length ?? 0;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row">
        <label>Kiegészítő csomag (.json)<input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} disabled={pending} /></label>
        {pending && <span className="muted" style={{ alignSelf: "end" }}><span className="spinner" aria-hidden /> {report || !file ? "Betöltés…" : "Előnézet készül…"}</span>}
      </div>
      {error && <div className="flash error">{error}</div>}
      {report && (
        <>
          {report.applied ? (
            <div className="flash ok">Betöltve: {news} tétel{skips ? `, ${skips} korábban már betöltött kihagyva` : ""}. A napló és a kimutatások frissültek.</div>
          ) : report.dryRun ? (
            <div className={`flash ${errors ? "error" : "ok"}`}>
              Előnézet{file?.note ? ` – ${file.note}` : ""}: {news} új tétel{skips ? `, ${skips} már betöltve (kimarad)` : ""}{errors ? `, ${errors} hibás – javítás nélkül nem tölthető be` : ""}. Még semmi nem került könyvelésre.
            </div>
          ) : (
            <div className="flash error">Nem töltöttem be semmit: {errors ? `${errors} tétel hibás` : "nem volt új tétel"}.</div>
          )}
          {report.created.matched.length > 0 && (
            <p className="small" style={{ margin: 0 }}>Meglévő partnerhez párosítva (adószám / név alapján): {report.created.matched.join(" · ")}</p>
          )}
          {(report.created.partners.length > 0 || report.created.vehicles.length > 0) && (
            <p className="muted small" style={{ margin: 0 }}>
              {report.applied ? "Felvéve" : "Felvételre kerül"}: {[...report.created.partners.map((p) => `partner: ${p}`), ...report.created.vehicles.map((v) => `gépkocsi: ${v}`)].join(" · ")}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ref</th><th>Típus</th><th>Tartalom</th><th className="num">Összeg</th><th>Bizonylat{report.applied ? "" : " (várható)"}</th><th>Állapot</th></tr></thead>
              <tbody>
                {report.results.map((r) => (
                  <tr key={r.ref}>
                    <td className="mono small">{r.ref}</td>
                    <td>{KIND[r.kind] ?? r.kind}</td>
                    <td className={r.status === "error" ? "neg" : undefined}>{r.message}</td>
                    <td className="num">{r.amount ? fmtHuf(r.amount) : ""}</td>
                    <td className="mono small">{r.entries.join(", ")}</td>
                    <td>{r.status === "new" ? <span className={`badge ${report.applied ? "posted" : "draft"}`}>{report.applied ? "könyvelve" : "új"}</span> : r.status === "skip" ? <span className="badge">már bent van</span> : <span className="badge overdue">hiba</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.dryRun && news > 0 && !errors && (
            <div className="row">
              <button className="primary" disabled={pending} onClick={() => { if (window.confirm(`Betöltsem a(z) ${news} tételt? Egyben kerül be: vagy minden, vagy semmi.`)) run(true); }}>
                {news} tétel betöltése és könyvelése
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
