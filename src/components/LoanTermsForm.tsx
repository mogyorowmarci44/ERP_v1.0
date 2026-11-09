"use client";

import { useState, useTransition } from "react";
import { importLoanTermsAction } from "@/app/c/[cid]/actions";

/** Már importált cégnél: tagi kölcsön lejáratok pótlása az import csomagból. */
export function LoanTermsForm({ cid }: { cid: number }) {
  const [json, setJson] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string; warnings?: string[] } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card grid" style={{ gap: 10 }}>
      <strong>Tagi kölcsön lejáratok pótlása</strong>
      <span className="muted">Ha a cégbe már importáltál, de a csomag újabb változata a tagi kölcsönök lejáratait is tartalmazza, itt csak azokat töltheted be. Más adat nem változik.</span>
      {msg?.error && <div className="flash error" style={{ margin: 0 }}>{msg.error}</div>}
      {msg?.ok && <div className="flash ok" style={{ margin: 0 }}>{msg.ok}{msg.warnings?.length ? ` Figyelmeztetés: ${msg.warnings.join("; ")}` : ""}</div>}
      <div className="row">
        <label>Import csomag (.json)<input type="file" accept="application/json,.json" onChange={async (e) => setJson((await e.target.files?.[0]?.text()) ?? null)} /></label>
        <button
          className="primary"
          style={{ alignSelf: "end" }}
          disabled={!json || pending}
          onClick={() =>
            start(async () => {
              const r = await importLoanTermsAction(cid, json!);
              setMsg(r.error ? { error: r.error } : { ok: `${r.added} lejárat betöltve.`, warnings: r.warnings });
            })
          }
        >
          Lejáratok betöltése
        </button>
      </div>
    </div>
  );
}
