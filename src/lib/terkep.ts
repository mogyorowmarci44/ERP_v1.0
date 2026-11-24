/** v4.1.0 – ERP-térkép segédek. */

/** JSON beágyazása <script>-be: a „<” és a sorelválasztók kódolva, hogy semmi ne zárhassa le a script blokkot. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** A sablon kitöltése a felhasználó cégeivel és a verzióval. */
export function fillTerkep(tpl: string, companies: Array<{ id: number; name: string; entityType: string }>, version: string) {
  return tpl.replace("__COMPANIES__", () => scriptJson(companies)).replace("__VERSION__", () => version.replace(/[^0-9.]/g, ""));
}
