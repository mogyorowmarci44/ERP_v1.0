/**
 * v3.1.0 – Az iktatószám rányomtatása a papír bizonylat digitális példányára (a papírra nem kell ráírni semmit).
 * PDF: az első oldal jobb felső sarkába; JPEG / PNG: a képből egyoldalas PDF készül a pecséttel.
 * Az eredeti fájl változatlanul marad az adatbázisban – a pecsét letöltéskor / megjelenítéskor készül.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

export type StampInfo = { filingNo: string; binder: string };

function drawStamp(page: PDFPage, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, s: StampInfo) {
  const { width, height } = page.getSize();
  const size = Math.max(9, Math.min(14, width / 45));
  const l1 = `Iktatószám: ${s.filingNo}`;
  const l2 = `Helye: ${s.binder}`.replace(/ő/g, "ö").replace(/ű/g, "ü").replace(/Ő/g, "Ö").replace(/Ű/g, "Ü"); // a beépített betűkészletben nincs ő / ű
  const w = Math.max(font.widthOfTextAtSize(l1, size), font.widthOfTextAtSize(l2, size * 0.8)) + size * 1.4;
  const h = size * 2.9;
  const x = width - w - size, y = height - h - size;
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), opacity: 0.92, borderColor: rgb(0.12, 0.31, 0.72), borderWidth: 1.2 });
  page.drawText(l1, { x: x + size * 0.7, y: y + h - size * 1.25, size, font, color: rgb(0.12, 0.31, 0.72) });
  page.drawText(l2, { x: x + size * 0.7, y: y + size * 0.55, size: size * 0.8, font, color: rgb(0.25, 0.3, 0.38) });
}

/** A pecsételt PDF bájtjai, vagy null, ha a fájltípust nem lehet pecsételni (pl. WEBP) – ilyenkor az eredeti megy ki. */
export async function stampDocument(b64: string, mime: string, filename: string, s: StampInfo): Promise<Uint8Array | null> {
  const bytes = Buffer.from(b64, "base64");
  try {
    if (/pdf/i.test(mime) || /\.pdf$/i.test(filename)) {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const page = pdf.getPage(0);
      drawStamp(page, await pdf.embedFont(StandardFonts.HelveticaBold), s);
      return await pdf.save();
    }
    const jpg = /jpe?g/i.test(mime) || /\.jpe?g$/i.test(filename);
    const png = /png/i.test(mime) || /\.png$/i.test(filename);
    if (!jpg && !png) return null;
    const pdf = await PDFDocument.create();
    const img = jpg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    // A4-es szélességre méretezve (595 pt), az arányt megtartva
    const scale = 595 / img.width;
    const page = pdf.addPage([595, img.height * scale]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: img.height * scale });
    drawStamp(page, await pdf.embedFont(StandardFonts.HelveticaBold), s);
    return await pdf.save();
  } catch {
    return null; // sérült / titkosított fájl – inkább az eredetit adjuk
  }
}
