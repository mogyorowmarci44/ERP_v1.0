/**
 * 2608 (havi járulékbevallás) előállítása egy már kitöltött ÁNYK-mentés mintájára.
 *
 * A 2608 sok lapos, személyenként (2608M) dinamikus lapokkal – a mezőkódokat nem a nulláról rakjuk össze, hanem egy, az ÁNYK-ban
 * kitöltött és betöltött bevallásból (sablon) indulunk: a személyes adatok (név, adóazonosító, TAJ, jogviszony-kód, FEOR …)
 * onnan jönnek, és csak az időszakot és az összegeket írjuk át a bérmodul adatai szerint. A rejtett ÁNYK-segédmezőket (0_12345)
 * kihagyjuk, azokat az ÁNYK importáláskor maga számolja.
 *
 * Ismert mezők (2608 v6.0):
 *   2608A  C027A/C028A időszak, C032A érintett személyek száma
 *          01-02 (0C) 28., 31. sor c = szocho (e Ft) · 01-04 (0E) 103. c, 109. c = szocho (Ft), 109. d = szocho (e Ft)
 *          01-05 (0F) 160. c = TB-járulék (Ft), 160. d = (e Ft)
 *   2608M  C007A adóazonosító, C017A/C018A név · E001A/E002A időszak
 *          M-08 (0F…) C001A/C002A jogviszony időtartama, 520. b/c munkakör időtartama
 *          M-09-02 (0I…) C001A/C002A időtartam, 626. c TB-járulék alapja, 629. c / 633. c TB-járulék (18,5%)
 *          M-04 (0E0001) 385. c szocho alapja, 386. c szocho (13%)
 */
import type { AnykSheet } from "./anyk";

export type Person2608 = { taxId: string; name: string; tbBase: number; tb: number; szochoBase: number; szocho: number };

const d8 = (iso: string) => iso.replace(/-/g, "");
const K = (ft: number) => Math.round(ft / 1000);
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** A sablon egy személyhez tartozó 2608M lapja – adóazonosító, ha nincs, név szerint. */
export function templatePerson(sheets: AnykSheet[], p: Pick<Person2608, "taxId" | "name">) {
  const ms = sheets.filter((s) => /08M$/.test(s.id));
  return ms.find((s) => p.taxId && s.fields["0_0A0001C007A"] === p.taxId.replace(/\D/g, ""))
    ?? ms.find((s) => norm(`${s.fields["0_0A0001C017A"] ?? ""}${s.fields["0_0A0001C018A"] ?? ""}`) === norm(p.name));
}

export function build2608Sheets(o: { template: AnykSheet[]; templateFrom: string; templateTo: string; from: string; to: string; people: Person2608[] }) {
  const warnings: string[] = [];
  const tf = d8(o.templateFrom), tt = d8(o.templateTo), nf = d8(o.from), nt = d8(o.to);
  const copy = (src: Record<string, string>) => {
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) {
      if (/^\d+_\d+$/.test(k)) continue; // rejtett ÁNYK-segédmező
      f[k] = v === tf ? nf : v === tt ? nt : v;
    }
    return f;
  };
  const main = o.template.find((s) => /08A$/.test(s.id));
  if (!main) throw new Error("A sablonban nincs 2608A főlap.");
  const sheets: AnykSheet[] = [];
  const done: Person2608[] = [];
  const persons: AnykSheet[] = [];
  for (const p of o.people) {
    const t = templatePerson(o.template, p);
    if (!t) { warnings.push(`${p.name}: nincs a sablonban 2608M lapja – töltsd ki egyszer az ÁNYK-ban, és töltsd be.`); continue; }
    const f = copy(t.fields);
    const put = (k: string, v: number) => { f[k] = String(Math.round(v)); };
    put("0_0IXXXXD0626CA", p.tbBase); put("0_0IXXXXD0629CA", p.tb); put("0_0IXXXXD0633CA", p.tb);
    put("0_0E0001E0385CA", p.szochoBase); put("0_0E0001E0386CA", p.szocho);
    persons.push({ id: t.id, version: t.version, fields: f });
    done.push(p);
  }
  const tb = done.reduce((a, p) => a + Math.round(p.tb), 0), sz = done.reduce((a, p) => a + Math.round(p.szocho), 0);
  const mf = copy(main.fields);
  mf["0_0A0001C032A"] = String(done.length);
  mf["0_0C0001C0028CA"] = mf["0_0C0001C0031CA"] = String(K(sz));
  mf["0_0E0001C0103CA"] = mf["0_0E0001C0109CA"] = String(sz);
  mf["0_0E0001C0109DA"] = String(K(sz));
  mf["0_0F0001C0160CA"] = String(tb);
  mf["0_0F0001C0160DA"] = String(K(tb));
  sheets.push({ id: main.id, version: main.version, fields: mf }, ...persons);
  return { sheets, warnings, totals: { tb, szocho: sz, people: done.length } };
}
