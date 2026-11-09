import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser, isMember } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const user = await getUser();
  if (!user || !(await isMember(user.id, cid))) return new Response("Nem található", { status: 404 });
  const [c] = await db
    .select({ data: schema.companies.logoData, mime: schema.companies.logoMime })
    .from(schema.companies)
    .where(eq(schema.companies.id, cid));
  if (!c?.data || !c.mime) return new Response("Nincs logó", { status: 404 });
  return new Response(Buffer.from(c.data, "base64"), {
    headers: {
      "Content-Type": c.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      // SVG-ben lévő szkript ne futhasson, ha valaki közvetlenül megnyitja
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
