/**
 * Bizonylat-kiolvasás a Claude API-val: egy hívás bizonylatonként, strukturált (JSON) válasz.
 * A kiolvasás csak adatot ad vissza – a könyvelésről a szabályalapú kód dönt (propose.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedDoc } from "@/db/schema";

export const EXTRACT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const money = { type: ["number", "null"] } as const;
const str = { type: ["string", "null"] } as const;
const party = {
  type: ["object", "null"],
  properties: { name: str, taxNumber: str, euVat: str, address: str, privatePerson: { type: ["boolean", "null"] } },
};

const TOOL: Anthropic.Tool = {
  name: "bizonylat",
  description: "A bizonylat kiolvasott adatai.",
  input_schema: {
    type: "object",
    required: ["docType"],
    properties: {
      docType: { type: "string", enum: ["invoice", "credit_note", "receipt", "sale_contract", "bank_statement", "proforma", "other"] },
      direction: { type: ["string", "null"], enum: ["in", "out", null], description: "in = a cég a vevő (szállítói számla), out = a cég az eladó (vevőszámla)" },
      seller: party,
      buyer: party,
      invoiceNumber: str,
      issueDate: { ...str, description: "YYYY-MM-DD" },
      fulfillmentDate: { ...str, description: "YYYY-MM-DD (teljesítés). Időszakos számlánál a teljesítés dátuma a számlán." },
      dueDate: { ...str, description: "YYYY-MM-DD" },
      paymentMethod: { type: ["string", "null"], enum: ["cash", "transfer", "card", null] },
      paid: { type: ["boolean", "null"], description: "a bizonylat szerint már kifizetve (pl. FIZETVE pecsét, kártyás / készpénzes nyugta)" },
      currency: { ...str, description: "ISO kód, pl. HUF, EUR" },
      periodic: { type: ["boolean", "null"], description: "időszakos elszámolású számla (pl. havi előfizetés időszakkal)" },
      lines: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "net"],
          properties: {
            description: { type: "string" },
            quantity: money,
            unitNet: money,
            net: { type: "number", description: "a tétel nettó értéke a számla pénznemében (különbözeti / ÁFA nélküli tételnél a teljes összeg)" },
            vatRate: money,
            vatType: { ...str, description: "27 | 18 | 5 | 0 | AAM (alanyi mentes) | TAM (tárgyi mentes) | KÜL (különbözeti, K.AFA, használt cikk) | TAH (Áfa tv. hatályán kívül, AHK) | FAD (fordított adózás, reverse charge, intra-community service) | M (EU-s különbözeti, §25a)" },
            vat: money,
            gross: money,
          },
        },
      },
      totals: { type: ["object", "null"], properties: { net: money, vat: money, gross: money } },
      vehicle: {
        type: ["object", "null"],
        description: "ha a bizonylat gépkocsira vonatkozik (adásvétel, honosítás, javítás): rendszám és/vagy alvázszám (VIN, 17 karakter)",
        properties: { make: str, model: str, plate: str, vin: str, year: { type: ["integer", "null"] }, km: { type: ["integer", "null"] } },
      },
      refInvoiceNumber: { ...str, description: "sztornó / helyesbítő számlánál az eredeti számla száma" },
      statement: {
        type: ["object", "null"],
        description: "csak bankszámlakivonatnál",
        properties: {
          accountNumber: str, currency: str, number: str, periodFrom: str, periodTo: str, opening: money, closing: money,
          transactions: {
            type: "array",
            items: {
              type: "object",
              required: ["date", "amount"],
              properties: {
                date: { type: "string", description: "könyvelés napja YYYY-MM-DD" },
                valueDate: str,
                amount: { type: "number", description: "jóváírás pozitív, terhelés negatív, a számla pénznemében" },
                counterparty: str, counterpartyAccount: str, description: str, reference: { ...str, description: "közlemény / hivatkozás" },
                fxAmount: money, fxCurrency: str,
              },
            },
          },
        },
      },
      confidence: { type: ["number", "null"], description: "0–1: mennyire biztos a kiolvasás" },
      notes: { ...str, description: "bármi, ami bizonytalan vagy figyelmet érdemel" },
    },
  },
};

function prompt(company: { name: string; taxNumber: string | null }, hint: { kind: string; filename: string; subject?: string | null; from?: string | null }) {
  return [
    `Olvasd ki ennek a bizonylatnak az adatait a „bizonylat” eszközzel. A könyvelő cég: ${company.name}${company.taxNumber ? ` (adószám: ${company.taxNumber})` : ""}.`,
    "Ha a cég a vevő, direction = in; ha a cég az eladó / kiállító, direction = out.",
    "Dátumok YYYY-MM-DD formában, összegek számként (ezres elválasztó nélkül, tizedespont). Ne találj ki adatot: ami nem olvasható, legyen null.",
    "Magyar használtautó-kereskedés: a különbözeti (K.AFA, KÜL, „különbözet szerinti szabályozás – használt cikkek”) tételeknél nincs külön ÁFA; ilyenkor net = a teljes ellenérték, vatType = KÜL.",
    "Adásvételi szerződésnél (magánszemélytől vett autó) docType = sale_contract, az eladó adatai, a vételár egy tételként, és a gépkocsi rendszáma / alvázszáma.",
    "Díjbekérő / proforma: docType = proforma (nem könyvelendő).",
    hint.kind === "statement" ? "Ez várhatóan bankszámlakivonat: minden tranzakciót vegyél fel a statement.transactions listába, a terhelést negatív előjellel." : "",
    `Fájl: ${hint.filename}${hint.subject ? ` · e-mail tárgya: ${hint.subject}` : ""}${hint.from ? ` · feladó: ${hint.from}` : ""}`,
  ].filter(Boolean).join("\n");
}

export function extractionAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function extractDocument(
  file: { data: string; mime: string; filename: string },
  company: { name: string; taxNumber: string | null },
  hint: { kind: string; subject?: string | null; from?: string | null },
): Promise<ExtractedDoc> {
  if (!extractionAvailable()) throw new Error("Nincs beállítva az ANTHROPIC_API_KEY a Renderen – a kiolvasás nem érhető el.");
  const client = new Anthropic();
  const mime = file.mime.toLowerCase();
  let block: Anthropic.ContentBlockParam;
  if (mime === "application/pdf" || /\.pdf$/i.test(file.filename)) block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } };
  else if (/image\/(jpeg|jpg|png|gif|webp)/.test(mime)) block = { type: "image", source: { type: "base64", media_type: (mime === "image/jpg" ? "image/jpeg" : mime) as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: file.data } };
  else if (/xml|text/.test(mime) || /\.xml$/i.test(file.filename)) block = { type: "text", text: Buffer.from(file.data, "base64").toString("utf8").slice(0, 200_000) };
  else throw new Error(`Nem támogatott fájltípus: ${file.mime} (PDF, JPEG, PNG, WEBP vagy XML lehet).`);

  const res = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: [block, { type: "text", text: prompt(company, { ...hint, filename: file.filename }) }] }],
  });
  const tool = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  if (!tool) throw new Error("A kiolvasás nem adott vissza adatot.");
  return tool.input as ExtractedDoc;
}
