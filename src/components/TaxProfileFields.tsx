import type { TaxProfile } from "@/db/schema";
import { DEFAULT_TAX_PROFILE, SZJA_METHOD_LABEL } from "@/lib/entity";

/** v2.0 – Adószámos magánszemély (szálláshely) adózási profiljának mezői – új felvételnél és a beállításokban. */
export function TaxProfileFields({ p = DEFAULT_TAX_PROFILE }: { p?: TaxProfile | null }) {
  const v = p ?? DEFAULT_TAX_PROFILE;
  return (
    <>
      <label>SZJA adózási mód
        <select name="szjaMethod" defaultValue={v.szjaMethod}>
          {Object.entries(SZJA_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="hidden" name="vatExemptField" value="1" />
        <input type="checkbox" name="vatExempt" defaultChecked={v.vatExempt} /> Alanyi ÁFA-mentes
      </label>
      <label>Szobák száma<input name="rooms" type="number" min={1} defaultValue={v.rooms} required /></label>
      <label>Férőhely (ágy)<input name="beds" type="number" min={0} defaultValue={v.beds ?? ""} /></label>
      <label>Település<input name="settlement" defaultValue={v.settlement ?? ""} placeholder="pl. Szigetvár" /></label>
      <label>Szálláshely azonosító (NTAK)<input name="ntakId" defaultValue={v.ntakId ?? ""} placeholder="pl. MA22050104" /></label>
      <label>Tételes adó / szoba / év (Ft)<input name="flatRatePerRoom" type="number" min={0} defaultValue={v.flatRatePerRoom} /></label>
      <label>IFA (Ft / fő / éj)<input name="ifaPerNight" type="number" min={0} defaultValue={v.ifaPerNight ?? ""} placeholder="önkormányzati rendelet szerint" /></label>
      <label>Csatornák (vesszővel)<input name="channels" defaultValue={(v.channels ?? []).join(", ")} placeholder="Airbnb, Instagram, saját weboldal" /></label>
    </>
  );
}
