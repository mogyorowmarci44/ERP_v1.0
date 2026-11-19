import { requireCompany } from "@/lib/auth";
import { companyKpis } from "@/lib/kpi";
import { ArSugo, type EprOptions } from "@/components/ArSugo";
import { EPR_CATEGORY_LABEL, EPR_DRIVE_LABEL, eprRate, rateTableFor, type EprCategory, type EprDrive } from "@/lib/epr";
import { today } from "@/lib/dates";

/** ÁrSugó – árajánló: beszerzési ár + tervezett költségek → padló, cél és hirdetési ár. */
export default async function ArSugoPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  // célfedezet: az eladott autók medián „Fedezet II”-je, ugyanúgy, mint a KPI-Dashboardon
  const k = await companyKpis(cid).catch(() => null);
  const medianMargin = k?.margin.soldCount ? k.margin.medF2 : null;
  // EPR: a mai díjtábla kategóriánként és hajtásonként (a cég beállítása szerint díjátalánnyal vagy anélkül)
  const flat = !!company.settings.eprFlatRate;
  const d = today();
  const epr: EprOptions = {
    rates: Object.fromEntries((["M1", "N1", "3W"] as EprCategory[]).map((c) => [c,
      Object.fromEntries((["ice", "hev", "phev", "bev"] as EprDrive[]).map((dr) => [dr, eprRate(d, c, dr, flat)])),
    ])) as EprOptions["rates"],
    labels: EPR_CATEGORY_LABEL,
    driveLabels: EPR_DRIVE_LABEL,
    rateLabel: `${rateTableFor(d).label} · ${flat ? "díjátalány" : "átalány nélkül"}`,
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
