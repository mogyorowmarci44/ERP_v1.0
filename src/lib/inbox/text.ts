/**
 * Szöveg és táblázat kinyerése a bizonylatfájlokból – AI nélkül, a szerveren.
 *  - PDF: a beágyazott szövegréteg (a számlázóprogramok PDF-jei mind ilyenek), sorokba rendezve,
 *  - CSV / XLSX: bankkivonat-export sorai,
 *  - XML: a címkék nélküli szöveg.
 * A szkennelt / fotózott bizonylatok szövegét a Google Drive ingyenes OCR-je adja (Apps Script, lásd connector.ts).
 */
import ExcelJS from "exceljs";

export const isPdf = (mime: string, name: string) => /pdf/i.test(mime) || /\.pdf$/i.test(name);
export const isImage = (mime: string, name: string) => /^image\//i.test(mime) || /\.(jpe?g|png|webp|gif|heic|heif|tiff?)$/i.test(name);
export const isTable = (mime: string, name: string) => /csv|spreadsheet|excel|text\/plain/i.test(mime) && /\.(csv|txt|xlsx|xls)$/i.test(name) || /\.(csv|xlsx|xls)$/i.test(name);
export const isXml = (mime: string, name: string) => /xml/i.test(mime) || /\.xml$/i.test(name);

/** A PDF szövegrétege soronként; az egymástól távoli szövegdarabok közé két szóköz kerül (oszlopok). */
export async function pdfText(b64: string): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(b64, "base64")));
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 15); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    type It = { str: string; x: number; y: number; w: number };
    const items: It[] = [];
    for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      if (!it.str || !it.transform) continue;
      if (!it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0 });
    }
    // sorok: azonos (±2.5 pt) alapvonal, fentről lefelé, balról jobbra
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: It[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 2.5);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    const lines = rows.map((r) => {
      r.sort((a, b) => a.x - b.x);
      let s = "", end = -1e9;
      for (const it of r) {
        const gap = it.x - end;
        if (s) s += gap > 12 ? "  " : gap > 1 ? " " : "";
        s += it.str;
        end = it.x + it.w;
      }
      return s.replace(/[ \t]+$/g, "");
    });
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\f\n");
}

export const xmlText = (b64: string) =>
  Buffer.from(b64, "base64").toString("utf8").replace(/<\?[^>]*\?>/g, "").replace(/<([\w:.-]+)[^>]*>/g, "$1: ").replace(/<\/[^>]+>/g, "\n").replace(/\n\s*\n+/g, "\n");

/** CSV szöveg dekódolása: UTF-8, ha érvényes, különben Windows-1250 (a magyar netbankok exportja gyakran ilyen). */
function decodeText(buf: Buffer): string {
  const u = buf.toString("utf8");
  if (!u.includes("�")) return u.replace(/^﻿/, "");
  try { return new TextDecoder("windows-1250").decode(buf); } catch { return buf.toString("latin1"); }
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).slice(0, 5).join("\n");
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

export async function tableRows(b64: string, name: string): Promise<string[][]> {
  const buf = Buffer.from(b64, "base64");
  if (/\.xls$/i.test(name)) throw new Error("A régi .xls formátumot nem tudom olvasni – mentsd .xlsx-ként vagy töltsd le CSV-ben.");
  if (/\.xlsx$/i.test(name) || buf.subarray(0, 2).toString() === "PK") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws?.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      r.eachCell({ includeEmpty: true }, (c, col) => {
        const v = c.value as unknown;
        let s: string;
        if (v instanceof Date) s = v.toISOString().slice(0, 10);
        else if (v && typeof v === "object" && "result" in (v as object)) s = String((v as { result: unknown }).result ?? "");
        else if (v && typeof v === "object" && "richText" in (v as object)) s = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
        else s = v == null ? "" : String(v);
        vals[col - 1] = s.trim();
      });
      for (let i = 0; i < vals.length; i++) if (vals[i] == null) vals[i] = "";
      if (vals.some((x) => x)) rows.push(vals);
    });
    return rows;
  }
  return parseCsv(decodeText(buf));
}
