/**
 * v7.4.0 – Egységes, nyomtatható PDF-kimutatások (főkönyvi kivonat, eredménykimutatás, mérleg, nyitott tételek).
 * Magyar ékezetekhez beágyazott DejaVu Sans betűkészlet; minden oldal alján a Mogyorosi Holding™ védjegy,
 * a cég neve, az ERP verziója, a készítés ideje és az oldalszám.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { APP_VERSION } from "@/lib/version";

export type PdfColumn = { label: string; width: number; align?: "left" | "right" };
export type PdfRow = { cells: string[]; bold?: boolean; indent?: number; shade?: boolean; rule?: boolean };
export type PdfReport = { title: string; subtitle?: string; company: string; columns: PdfColumn[]; rows: PdfRow[]; note?: string; landscape?: boolean };

let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;
function fontBytes() {
  if (!fonts) {
    const dir = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
    fonts = { regular: readFileSync(path.join(dir, "DejaVuSans.ttf")), bold: readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")) };
  }
  return fonts;
}

const INK = rgb(0.11, 0.14, 0.2), MUTED = rgb(0.45, 0.5, 0.58), LINE = rgb(0.86, 0.88, 0.91), SHADE = rgb(0.955, 0.965, 0.98), ACCENT = rgb(0.12, 0.23, 0.37);

/** Szöveg levágása a cella szélességére (…). */
function fit(text: string, font: PDFFont, size: number, max: number): string {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderPdfReport(r: PdfReport, now = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular, bold } = fontBytes();
  const fR = await doc.embedFont(regular, { subset: true });
  const fB = await doc.embedFont(bold, { subset: true });
  doc.setTitle(`${r.title} – ${r.company}`);
  doc.setProducer(`mogyorosi.erp v${APP_VERSION}`);
  doc.setCreator("Mogyorosi Holding™ · mogyorosi.erp");

  const [W, H] = r.landscape ? [842, 595] : [595, 842];
  const M = 36, SIZE = 8.5, ROW = 14, top = H - M;
  const totalW = r.columns.reduce((s, c) => s + c.width, 0);
  const scale = Math.min(1, (W - 2 * M) / totalW);
  const cols = r.columns.map((c) => ({ ...c, width: c.width * scale }));
  const stamp = now.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const pages: PDFPage[] = [];

  const header = (p: PDFPage, first: boolean) => {
    let y = top;
    if (first) {
      p.drawText(r.title, { x: M, y: y - 16, size: 16, font: fB, color: ACCENT });
      y -= 22;
      p.drawText(r.company, { x: M, y: y - 11, size: 10.5, font: fB, color: INK });
      y -= 14;
      if (r.subtitle) { p.drawText(r.subtitle, { x: M, y: y - 10, size: 9, font: fR, color: MUTED }); y -= 13; }
      y -= 8;
    } else {
      p.drawText(`${r.title} – ${r.company}`, { x: M, y: y - 10, size: 9, font: fB, color: MUTED });
      y -= 18;
    }
    // oszlopfejléc
    p.drawRectangle({ x: M, y: y - ROW + 3, width: W - 2 * M, height: ROW, color: SHADE });
    let x = M;
    for (const c of cols) {
      const t = fit(c.label, fB, SIZE, c.width - 6);
      const tx = c.align === "right" ? x + c.width - 3 - fB.widthOfTextAtSize(t, SIZE) : x + 3;
      p.drawText(t, { x: tx, y: y - 8, size: SIZE, font: fB, color: INK });
      x += c.width;
    }
    return y - ROW - 2;
  };

  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = header(page, true);
  for (const row of r.rows) {
    if (y < M + 30) { page = doc.addPage([W, H]); pages.push(page); y = header(page, false); }
    if (row.shade) page.drawRectangle({ x: M, y: y - ROW + 4, width: W - 2 * M, height: ROW, color: SHADE });
    if (row.rule) page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: LINE });
    const f = row.bold ? fB : fR;
    let x = M;
    cols.forEach((c, i) => {
      const raw = row.cells[i] ?? "";
      const pad = i === 0 && row.indent ? row.indent * 10 : 0;
      const t = fit(raw, f, SIZE, c.width - 6 - pad);
      const tx = c.align === "right" ? x + c.width - 3 - f.widthOfTextAtSize(t, SIZE) : x + 3 + pad;
      page.drawText(t, { x: tx, y: y - 7, size: SIZE, font: f, color: INK });
      x += c.width;
    });
    y -= ROW;
  }
  if (r.note) {
    if (y < M + 40) { page = doc.addPage([W, H]); pages.push(page); y = top; }
    page.drawText(fit(r.note, fR, 8, W - 2 * M), { x: M, y: y - 14, size: 8, font: fR, color: MUTED });
  }
  // lábléc minden oldalon: védjegy · cég · verzió · időpont · oldalszám
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 4 }, end: { x: W - M, y: M - 4 }, thickness: 0.5, color: LINE });
    p.drawText(`Mogyorosi Holding™ · mogyorosi.erp v${APP_VERSION} · ${r.company} · készült: ${stamp}`, { x: M, y: M - 16, size: 7.5, font: fR, color: MUTED });
    const pg = `${i + 1}. / ${pages.length} oldal`;
    p.drawText(pg, { x: W - M - fR.widthOfTextAtSize(pg, 7.5), y: M - 16, size: 7.5, font: fR, color: MUTED });
  });
  return doc.save();
}
