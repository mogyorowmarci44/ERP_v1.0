import { requireCompany } from "@/lib/auth";
import { companyKpis } from "@/lib/kpi";
import { ArSugo, type EprOptions } from "@/components/ArSugo";
import { EPR_CATEGORY_LABEL, eprRate, rateTableFor } from "@/lib/epr";
import { today } from "@/lib/dates";

/** ÁrSugó – árajánló: beszerzési ár + tervezett költségek → padló, cél és hirdetési ár. */
export default async function ArSugoPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  // célfedezet: az eladott autók medián „Fedezet II”-je, ugyanúgy, mint a KPI-Dashboardon
  const k = await companyKpis(cid).catch(() => null);
  const medianMargin = k?.margin.soldCount ? k.margin.medF2 : null;
  // EPR: a mai díjtábla, belső égésű hajtással (a cég beállítása szerint díjátalánnyal vagy anélkül)
  const flat = !!company.settings.eprFlatRate;
  const d = today();
  const epr: EprOptions = {
    rates: { M1: eprRate(d, "M1", "ice", flat), N1: eprRate(d, "N1", "ice", flat), "3W": eprRate(d, "3W", "ice", flat) },
    labels: EPR_CATEGORY_LABEL,
    rateLabel: `${rateTableFor(d).label} · ${flat ? "díjátalány" : "átalány nélkül"} · belső égésű`,
  };
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁrSugó</h1>
          <p className="muted" style={{ margin: 0 }}>Te adod meg a beszerzési árat és a tervezett költségeket, a többit kiszámolja.</p>
        </div>
      </div>
      <ArSugo medianMargin={medianMargin} soldCount={k?.margin.soldCount ?? 0} epr={epr} />
    </>
  );
}
