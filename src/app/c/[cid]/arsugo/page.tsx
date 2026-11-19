import { requireCompany } from "@/lib/auth";
import { companyKpis } from "@/lib/kpi";
import { ArSugo } from "@/components/ArSugo";

/** ÁrSugó – árajánló: beszerzési ár + tervezett költségek → padló, cél és hirdetési ár. */
export default async function ArSugoPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  await requireCompany(cid);
  // célfedezet: az eladott autók medián „Fedezet II”-je, ugyanúgy, mint a KPI-Dashboardon
  const k = await companyKpis(cid).catch(() => null);
  const medianMargin = k?.margin.soldCount ? k.margin.medF2 : null;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁrSugó</h1>
          <p className="muted" style={{ margin: 0 }}>Te adod meg a beszerzési árat és a tervezett költségeket, a többit kiszámolja.</p>
        </div>
      </div>
      <ArSugo medianMargin={medianMargin} soldCount={k?.margin.soldCount ?? 0} />
    </>
  );
}
