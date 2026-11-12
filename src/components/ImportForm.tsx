"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { importBundleAction } from "@/app/c/[cid]/actions";
import type { ImportReport } from "@/lib/importer";
import { fmtHuf } from "@/lib/money";
import { progress } from "@/lib/progress";

type Preview = { partners: number; vehicles: number; kinds: Record<string, number>; from?: string; to?: string; log: string[][]; source?: string };

export function ImportForm({ cid }: { cid: number }) {
  const [json, setJson] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();

  const onFile = async (f: File | undefined) => {
    setError(null); setReport(null); setPreview(null);
    if (!f) return;
    const text = await f.text();
    try {
      const b = JSON.parse(text);
      if (b.format !== "mm-erp-import/1") throw new Error("Ez nem MM ERP import csomag.");
      const kinds: Record<string, number> = {};
      for (const d of b.documents) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
      const dates = b.documents.map((d: { date?: string }) => d.date).filter(Boolean).sort();
      setPreview({ partners: b.partners.length, vehicles: b.vehicles.length, kinds, from: dates[0], to: dates[dates.length - 1], log: b.log ?? [], source: b.source });
      setJson(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = () =>
    start(async () => {
      setError(null);
      // Egy tranzakcióban fut a szerveren: a % a korábbi importok dokumentumonkénti idejéből becsült
      const docs = preview ? Object.values(preview.kinds).reduce((a, b) => a + b, 0) : 1;
      const id = progress.start({ key: "import:doc", label: `Importálás – ${docs} tétel…`, manual: true, units: docs, expectedMs: 600 + docs * 60 });
      try {
        const res = await importBundleAction(cid, json!);
        if (res.error) {
          setError(res.error);
          progress.done(id, { cancel: true });
        } else {
          setReport(res.report!);
          progress.done(id);
        }
      } catch (e) {
        progress.done(id, { cancel: true });
        throw e;
      }
    });

  const kindHu: Record<string, string> = { invoice: "számla", entry: "vegyes / bank / pénztár tétel", sale_payment: "vevői befizetés", cogs_ref: "ELÁBÉ-összevetés", sale_entry: "egyéb eladás" };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {error && <div className="flash error">{error}</div>}
      {!report && (
        <div className="card row">
          <label>Import csomag (.json)<input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
      )}
      {preview && !report && (
        <div className="card grid" style={{ gap: 10 }}>
          <strong>{preview.source ?? "Import csomag"}</strong>
          <span>Időszak: {preview.from} – {preview.to}</span>
          <span>{preview.partners} partner, {preview.vehicles} gépkocsi, {Object.entries(preview.kinds).map(([k, n]) => `${n} ${kindHu[k] ?? k}`).join(", ")}</span>
          <details>
            <summary>Átalakítási napló ({preview.log.length} megjegyzés)</summary>
            <table style={{ marginTop: 8 }}>
              <tbody>{preview.log.map((l, i) => <tr key={i}><td>{l[0]}</td><td className="mono">{l[1]}</td><td className="mono">{l[2]}</td><td>{l[3]}</td></tr>)}</tbody>
            </table>
          </details>
          <div className="row">
            <button className="primary" onClick={run} disabled={pending} data-progress="off">Importálás indítása</button>
            {pending && <span className="muted">Könyvelés folyamatban, ez akár egy-két percig is tarthat. Ne zárd be az oldalt.</span>}
          </div>
        </div>
      )}
      {report && (
        <div className="card grid" style={{ gap: 10 }}>
          <div className="flash ok" style={{ margin: 0 }}>Import kész: {Object.entries(report.counts).map(([k, n]) => `${n} ${k}`).join(", ")}.</div>
          <span>Különbözeti ÁFA eltérés a bevallottól: {report.vatDiffs.length === 0 ? "nincs" : `${report.vatDiffs.length} számlán`}</span>
          {report.warnings.length > 0 && (
            <details open><summary>Figyelmeztetések ({report.warnings.length})</summary><ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          )}
          {report.cogsDiffs.length > 0 && (
            <details>
              <summary>ELÁBÉ: régi táblázat vs. app ({report.cogsDiffs.length} gépkocsi)</summary>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Gépkocsi</th><th className="num">Régi táblázat</th><th className="num">App</th><th className="num">Különbség</th></tr></thead>
                <tbody>{report.cogsDiffs.map((c, i) => <tr key={i}><td>{c.vehicle}</td><td className="num">{fmtHuf(c.source)}</td><td className="num">{fmtHuf(c.app)}</td><td className="num">{fmtHuf(c.app - c.source)}</td></tr>)}</tbody>
              </table>
            </details>
          )}
          <div className="row">
            <Link className="btn primary" href={`/c/${cid}/reports/statements?type=bs&gran=month&from=2025-05-01`}>Mérleg megnyitása</Link>
            <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>Gépkocsik</Link>
          </div>
        </div>
      )}
    </div>
  );
}
