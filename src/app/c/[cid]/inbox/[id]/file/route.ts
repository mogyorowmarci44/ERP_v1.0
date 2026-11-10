import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** A beérkező bizonylat eredeti fájlja (előnézet / letöltés). */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  const [d] = await db.select().from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.id, Number(p.id)), eq(schema.inboxDocuments.companyId, cid)));
  if (!d) return new Response("Nem található", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(d.data, "base64")), {
    headers: {
      "Content-Type": d.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
