/**
 * Bizonylat kiolvasása – elsősorban ingyenesen, AI nélkül:
 *  1. CSV / Excel bankkivonat-export → táblázat-beolvasás (pontos),
 *  2. PDF szövegréteg / XML → szabályalapú kiolvasás,
 *  3. kép vagy szkennelt PDF → a Google Drive ingyenes OCR-je (Apps Script) → szabályalapú kiolvasás,
 *  4. csak ha be van állítva ANTHROPIC_API_KEY és a szabályok nem adtak teljes eredményt: Claude.
 * Ami így sem teljes, az a jóváhagyási listába kerül (nem könyvelődik magától).
 */
import type { ExtractedDoc, InboxSettings } from "@/db/schema";
import { isImage, isPdf, isTable, isXml, pdfText, tableRows, xmlText } from "./text";
import { parseDocumentText, parseStatementTable } from "./rules";
import { ocrRemote } from "./connector";
import { extractDocument, extractionAvailable } from "./extract";

export type ReadMethod = "table" | "text" | "ocr" | "ai" | "none";

const complete = (x: ExtractedDoc) =>
  x.docType === "bank_statement"
    ? (x.statement?.transactions?.length ?? 0) > 0
    : x.docType === "proforma" || (!!x.invoiceNumber || x.docType === "sale_contract") && !!x.issueDate && x.totals?.gross != null && (x.lines?.length ?? 0) > 0 && (x.confidence ?? 0) >= 0.85;

export async function readDocument(
  file: { data: string; mime: string; filename: string },
  company: { name: string; taxNumber: string | null },
  hint: { kind: string; subject?: string | null; from?: string | null },
  settings: InboxSettings,
): Promise<ExtractedDoc> {
  const { mime, filename: name } = file;
  if (isTable(mime, name)) {
    const x = parseStatementTable(await tableRows(file.data, name));
    return { ...x, method: "table" };
  }

  let text = "";
  let method: ReadMethod = "text";
  const warnings: string[] = [];
  if (isXml(mime, name)) text = xmlText(file.data);
  else if (isPdf(mime, name)) {
    try { text = await pdfText(file.data); } catch (e) { warnings.push(`A PDF szövege nem olvasható: ${(e as Error).message}`); }
  }
  const letters = text.replace(/[^A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, "").length;
  if (letters < 40 && (isImage(mime, name) || isPdf(mime, name))) {
    if (settings.scriptUrl && settings.secretEnc) {
      try { text = await ocrRemote(settings, file); method = "ocr"; }
      catch (e) { warnings.push(`Szövegfelismerés (Google Drive OCR) sikertelen: ${(e as Error).message}`); }
    } else warnings.push("Szkennelt / fotózott bizonylat: a szövegfelismeréshez állítsd be a Google-kapcsolatot (Beállítások).");
  }

  let x: ExtractedDoc | null = text.trim() ? parseDocumentText(text, company, { ...hint, filename: name }) : null;
  if (x && method === "ocr" && x.confidence != null) x.confidence = Math.min(x.confidence, 0.9); // OCR-nél egy szinttel óvatosabb

  if ((!x || !complete(x)) && extractionAvailable() && !isTable(mime, name)) {
    try {
      const ai = await extractDocument(file, company, hint);
      return { ...ai, method: "ai", rawText: text.slice(0, 20000) || null };
    } catch (e) { warnings.push(`AI-kiolvasás sikertelen: ${(e as Error).message}`); }
  }
  if (!x) {
    return {
      docType: hint.kind === "statement" ? "bank_statement" : "invoice",
      confidence: 0, lines: [], method: "none", rawText: null,
      notes: [...warnings, "Nem sikerült szöveget kinyerni – töltsd ki kézzel."].join(" "),
    };
  }
  return { ...x, method, rawText: text.slice(0, 20000), notes: [x.notes, ...warnings].filter(Boolean).join(" ") };
}
