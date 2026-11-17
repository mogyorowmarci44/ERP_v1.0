/** Kiegészítő melléklet – szöveg ⇄ fejezetek, egyszerű jelölés (tiszta függvények, DB nélkül). */
import type { AnnualSection } from "@/db/schema";

// ---------------------------------------------------------------------------
// Kiegészítő melléklet – szöveg ⇄ fejezetek, egyszerű jelölés
// ---------------------------------------------------------------------------

/** „## 1. Cím” sorokkal tagolt szövegből fejezetek. */
export function parseSections(text: string): AnnualSection[] {
  const out: AnnualSection[] = [];
  let cur: AnnualSection | null = null;
  const body: string[] = [];
  const flush = () => {
    if (cur) out.push({ ...cur, body: body.join("\n").replace(/^\n+|\n+$/g, "") });
    body.length = 0;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const m = /^(\d+(?:\.\d+)*\.?|[IVX]+\.)\s+(.*)$/.exec(h[1].trim());
      cur = m ? { no: m[1], title: m[2].trim(), body: "" } : { no: "", title: h[1].trim(), body: "" };
    } else if (cur) body.push(line);
    else if (line.trim()) {
      cur = { no: "", title: "Bevezetés", body: "" };
      body.push(line);
    }
  }
  flush();
  return out;
}

export function sectionsToText(sections: AnnualSection[]): string {
  return sections.map((s) => `## ${s.no ? `${s.no} ` : ""}${s.title}\n\n${s.body}`).join("\n\n");
}

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "table"; head: string[] | null; rows: string[][] };

/** Fejezettörzs blokkokra: üres sor = bekezdéshatár; „### ” alcím; „- ” felsorolás; „|” táblázat (a „|---|” sor előtti sor a fejléc). */
export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^###\s+/.test(l)) { out.push({ t: "h", text: l.replace(/^###\s+/, "").trim() }); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const tl: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) tl.push(lines[i++]);
      const sep = tl.findIndex((x) => /^\s*\|[\s:|-]+\|?\s*$/.test(x) && x.includes("-"));
      if (sep === 1) out.push({ t: "table", head: cells(tl[0]), rows: tl.slice(2).map(cells) });
      else out.push({ t: "table", head: null, rows: tl.filter((_, k) => k !== sep).map(cells) });
      continue;
    }
    if (/^\s*[-•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-•]\s+/, ""));
      out.push({ t: "ul", items });
      continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-•]\s|###\s)/.test(lines[i])) p.push(lines[i++].trim());
    out.push({ t: "p", text: p.join(" ") });
  }
  return out;
}

/** **félkövér** darabolás megjelenítéshez. */
export function inlineParts(s: string): Array<{ b: boolean; s: string }> {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((x) => (x.startsWith("**") && x.endsWith("**") ? { b: true, s: x.slice(2, -2) } : { b: false, s: x }));
}

/** Szám-e a cella (jobbra igazításhoz): „1 234 567”, „-36 388”, „12,5%”, „–”. */
export const isNumCell = (s: string) => /^[-−+]?[\d\s.,]+%?(\s*Ft)?$/.test(s.replace(/ /g, " ").trim()) || s.trim() === "–";

