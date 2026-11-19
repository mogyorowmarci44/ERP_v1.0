"use client";

import { clearSalePlanAction } from "@/app/c/[cid]/forecast/actions";

/**
 * Egy készleten lévő autó eladási tervének törlése: az eladási ár és a dátum mezőt azonnal kiüríti
 * (a még nem mentett beírást is), és ha van mentett terv, azt a szerveren is törli.
 */
export function ClearSalePlan({ cid, planId, row, form, saved }: { cid: number; planId?: number; row: string; form: string; saved: boolean }) {
  const clearInputs = () => {
    for (const f of ["salePrice", "saleDate"]) {
      const el = document.querySelector<HTMLInputElement>(`input[form="${form}"][name="${row}:${f}"]`);
      if (el) el.value = "";
    }
  };
  return (
    <form
      action={clearSalePlanAction}
      onSubmit={(e) => {
        clearInputs();
        if (!saved || !planId) e.preventDefault(); // nincs mentett terv: elég a mezőket üríteni
      }}
    >
      <input type="hidden" name="cid" value={cid} />
      {planId && <input type="hidden" name="planId" value={planId} />}
      <button className="link" title="Az eladási ár és dátum törlése ennél az autónál">törlés</button>
    </form>
  );
}
