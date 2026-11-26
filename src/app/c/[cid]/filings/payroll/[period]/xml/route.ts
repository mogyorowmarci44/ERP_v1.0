import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { payroll2608Xml } from "@/lib/payroll-2608-data";

export const dynamic = "force-dynamic";

/** Egy hónap 2608-as ÁNYK-XML-je a Bérszámfejtés adataiból, a cég betöltött 2608 mintája alapján: /c/:cid/filings/payroll/:period/xml */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; period: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  await audit({ action: "export.file", companyId: cid, target: new URL(_req.url).pathname.slice(0, 255) }); // v6.0.0
  if (!/^\d{4}-\d{2}$/.test(p.period)) return new Response("Hibás időszak.", { status: 400 });
  try {
    const { xml, warnings } = await payroll2608Xml(cid, p.period);
    const body = new TextEncoder().encode(xml);
    return new Response(body, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="2608_${p.period}_eredeti.xml"`,
        "Cache-Control": "no-store",
        "Content-Length": String(body.byteLength),
        ...(warnings.length ? { "X-Warnings": encodeURIComponent(warnings.join(" | ")) } : {}),
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
