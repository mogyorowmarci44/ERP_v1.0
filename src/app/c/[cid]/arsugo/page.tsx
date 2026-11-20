import { requireCompany } from "@/lib/auth";
import { companyKpis } from "@/lib/kpi";
import { ArSugo, type EprOptions, type ArSugoInitial } from "@/components/ArSugo";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadAutoMerleg } from "@/lib/auto-merleg";
import { EPR_CATEGORY_LABEL, EPR_DRIVE_LABEL, eprRate, rateTableFor, type EprCategory, type EprDrive } from "@/lib/epr";
import { today } from "@/lib/dates";

/** ÁrSugó – árajánló: beszerzési ár + tervezett költségek → padló, cél és hirdetési ár. */
export default async function ArSugoPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
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
  // v3.4.0 – az AutóMérlegből megnyitva: az autó beszerzése, eddigi költségei és EPR-adatai előre kitöltve
  let initial: ArSugoInitial | undefined;
  const vid = Number(sp.vehicle);
  if (vid) {
    const [v] = await db.select().from(schema.vehicles).where(and(eq(schema.vehicles.id, vid), eq(schema.vehicles.companyId, cid)));
    const m = v ? await loadAutoMerleg(cid, vid) : null;
    if (v && m) {
      initial = {
        title: `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}`, vehicleId: vid,
        buy: m.input.buy, buyMode: m.input.buyMode, sellMode: m.input.sellMode,
        costs: m.input.costs.map((c) => ({ name: c.label, amount: Math.round(c.amount) })),
        eprCat: m.input.epr != null && v.eprCategory ? (v.eprCategory as EprCategory) : "none",
        eprDrive: (v.eprDrive as EprDrive | null) ?? "ice", massKg: v.eprMassKg ?? 0,
      };
    }
  }
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁrSugó{initial ? ` · ${initial.title}` : ""}</h1>
          <p className="muted" style={{ margin: 0 }}>Te adod meg a beszerzési árat és a tervezett költségeket, a többit kiszámolja.</p>
        </div>
      </div>
      <ArSugo medianMargin={medianMargin} soldCount={k?.margin.soldCount ?? 0} epr={epr} initial={initial} cid={cid} />
    </>
  );
}
