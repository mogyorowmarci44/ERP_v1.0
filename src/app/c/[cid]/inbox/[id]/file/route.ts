import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { binderPositions } from "@/lib/inbox/service";
import { stampDocument } from "@/lib/inbox/stamp";
import { docData } from "@/lib/file-store";

export const dynamic = "force-dynamic";

/**
 * A beérkező bizonylat fájlja (előnézet / letöltés).
 * v3.1.0: papír bizonylatnál az iktatószámmal és a lefűzőbeli hellyel pecsételt PDF; `?original=1` = az eredeti fájl.
 */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  const [d] = await db.select().from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.id, Number(p.id)), eq(schema.inboxDocuments.companyId, cid)));
  if (!d) return new Response("Nem található", { status: 404 });
  const original = new URL(req.url).searchParams.get("original") === "1";
  const data = await docData(d); // v6.7.0 – adatbázisból vagy a fájltárolóból
  let body: Uint8Array = new Uint8Array(Buffer.from(data, "base64"));
  let mime = d.mime;
  let name = d.filename;
  if (d.filingNo && !original) {
    const pos = (await binderPositions(cid, [d.id])).get(d.id);
    const stamped = await stampDocument(data, d.mime, d.filename, { filingNo: d.filingNo, binder: pos?.label ?? "–" });
    if (stamped) {
      body = stamped;
      mime = "application/pdf";
      name = `${d.filingNo} ${d.filename.replace(/\.[^.]+$/, "")}.pdf`;
    }
  }
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
