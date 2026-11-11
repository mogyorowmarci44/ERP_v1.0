/** Számok betűvel (magyar helyesírás: 2000 fölött a hármas csoportok közé kötőjel). */
const ONES = ["", "egy", "kettő", "három", "négy", "öt", "hat", "hét", "nyolc", "kilenc"];
const ONES_C = ["", "egy", "két", "három", "négy", "öt", "hat", "hét", "nyolc", "kilenc"]; // összetételben (kétszáz, kétezer)
const TENS = ["", "tíz", "húsz", "harminc", "negyven", "ötven", "hatvan", "hetven", "nyolcvan", "kilencven"];
const TENS_C = ["", "tizen", "huszon", "harminc", "negyven", "ötven", "hatvan", "hetven", "nyolcvan", "kilencven"];

/** 1–999; `final` = a szám végén áll (kettő), különben „két”. */
function under1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  let s = "";
  if (h) s += (h === 1 ? "" : ONES_C[h]) + "száz";
  if (t) s += o ? TENS_C[t] : TENS[t];
  if (o) s += final ? ONES[o] : ONES_C[o];
  return s;
}

export function numberToHungarian(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return "nulla";
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const names = ["", "ezer", "millió", "milliárd", "billió"];
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) parts.push(under1000(g, true));
    else if (i === 1 && g === 1) parts.push("ezer");
    else parts.push(under1000(g, false) + names[i]);
  }
  const total = Math.round(Math.abs(value));
  return (value < 0 ? "mínusz " : "") + parts.join(total > 2000 ? "-" : "");
}
