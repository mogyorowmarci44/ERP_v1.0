"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeLine, type VatKind } from "@/lib/posting";
import { fmtHuf, parseNumber } from "@/lib/money";
import type { AccountOpt, PartnerOpt, VatOpt, VehicleOpt } from "@/lib/options";
import { saveInvoiceAction, getRateAction } from "@/app/c/[cid]/actions";
import { vatRateDate } from "@/lib/fx";
import { fmtDate } from "@/lib/dates";

type Line = { description: string; quantity: string; unitPrice: string; vatCodeId: number; accountId: number; vehicleId: number | null };

export type InvoiceFormInitial = {
  partnerId: number | null;
  invoiceNumber: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string;
  paymentMethod: string;
  currency: string;
  exchangeRate: string;
  rateManual: boolean;
  periodic: boolean;
  note: string;
  lines: Line[];
};

export function InvoiceForm(props: {
  cid: number;
  direction: "out" | "in";
  partners: PartnerOpt[];
  accounts: AccountOpt[];
  vatCodes: VatOpt[];
  vehicles: VehicleOpt[];
  initial: InvoiceFormInitial;
  invoiceId?: number;
}) {
  const { cid, direction, partners, accounts, vatCodes, vehicles } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState(props.initial);
  const [lines, setLines] = useState<Line[]>(props.initial.lines);

  const accByCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? accounts[0]?.id ?? 0;
  const vatByCode = (code: string) => vatCodes.find((v) => v.code === code)?.id ?? vatCodes[0]?.id ?? 0;
  const vatOf = (id: number) => vatCodes.find((v) => v.id === id);
  const vehOf = (id: number | null) => vehicles.find((v) => v.id === id);

  const newLine = (): Line => ({
    description: "",
    quantity: "1",
    unitPrice: "",
    vatCodeId: vatByCode("27"),
    accountId: accByCode(direction === "out" ? "913" : "523"),
    vehicleId: null,
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Gépkocsi választásakor értelmes alapértelmezések (ÁFA-kód, ellenszámla, megnevezés). */
  const pickVehicle = (i: number, vid: number | null) => {
    const v = vehOf(vid);
    const patch: Partial<Line> = { vehicleId: vid };
    if (v) {
      const margin = v.vatTreatment === "margin";
      if (direction === "out") {
        patch.vatCodeId = vatByCode(margin ? "KÜL27" : "27");
        patch.accountId = accByCode(margin ? "911" : "912");
      } else {
        patch.accountId = accByCode("261");
      }
      if (!lines[i].description) patch.description = v.label;
    }
    setLine(i, patch);
  };

  // Áfa tv. 80. § szerinti árfolyam-nap és az aznapi MNB árfolyam automatikus lekérése
  const kinds = lines.map((l) => vatOf(l.vatCodeId)?.kind ?? "normal");
  const rd = vatRateDate({ issueDate: h.issueDate, fulfillmentDate: h.fulfillmentDate, periodic: h.periodic, vatKinds: kinds });
  const [rateMsg, setRateMsg] = useState<string>("");
  useEffect(() => {
    if (h.currency === "HUF" || h.rateManual || !rd.date) return;
    let alive = true;
    setRateMsg("MNB árfolyam lekérése…");
    getRateAction(cid, h.currency, rd.date).then((r) => {
      if (!alive) return;
      if (r.error || !r.rate) setRateMsg(r.error ?? "Nincs árfolyam");
      else {
        setH((x) => ({ ...x, exchangeRate: String(r.rate).replace(".", ",") }));
        setRateMsg(`MNB ${fmtDate(r.rateDate)} jegyzés`);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.currency, h.rateManual, rd.date, cid]);

  const fxRate = h.currency === "HUF" ? 1 : parseNumber(h.exchangeRate) || 0;
  const preview = useMemo(() => {
    let net = 0, vat = 0, gross = 0, payable = 0;
    const rows = lines.map((l) => {
      const vc = vatOf(l.vatCodeId);
      if (!vc) return null;
      try {
        const marginBase = vc.kind === "margin" && direction === "out" ? vehOf(l.vehicleId)?.marginBase ?? null : null;
        if (vc.kind === "margin" && direction === "out" && marginBase === null) return { warn: "válassz gépkocsit" };
        const a = computeLine(
          { quantity: parseNumber(l.quantity), unitPrice: parseNumber(l.unitPrice), vatRate: vc.rate, vatKind: vc.kind as VatKind, marginPurchaseHuf: marginBase },
          direction,
          fxRate || 1,
        );
        net += a.netHuf; vat += a.vatHuf; gross += a.grossHuf; payable += a.payableHuf;
        return { a, marginBase };
      } catch {
        return { warn: "hibás szám" };
      }
    });
    return { rows, net, vat, gross, payable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, fxRate, direction]);

  const submit = (postNow: boolean) => {
    setError(null);
    start(async () => {
      try {
        const res = await saveInvoiceAction(
          cid,
          {
            direction,
            partnerId: Number(h.partnerId),
            invoiceNumber: h.invoiceNumber,
            issueDate: h.issueDate,
            fulfillmentDate: h.fulfillmentDate,
            dueDate: h.dueDate || null,
            paymentMethod: h.paymentMethod,
            currency: h.currency,
            exchangeRate: fxRate,
            rateManual: h.rateManual,
            periodic: h.periodic,
            note: h.note || null,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: parseNumber(l.quantity),
              unitPrice: parseNumber(l.unitPrice),
              vatCodeId: l.vatCodeId,
              accountId: l.accountId,
              vehicleId: l.vehicleId,
            })),
          },
          props.invoiceId,
          postNow,
        );
        if (res.error) setError(res.error);
        else router.push(`/c/${cid}/invoices/${res.id}?ok=${encodeURIComponent(postNow ? "Számla könyvelve." : "Piszkozat mentve.")}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const hasMargin = lines.some((l) => vatOf(l.vatCodeId)?.kind === "margin");

  return (
    <div className="grid" style={{ gap: 16 }}>
      {error && <div className="flash error">{error}</div>}
      <div className="card form-grid">
        <label>Partner
          <select value={h.partnerId ?? ""} onChange={(e) => setH({ ...h, partnerId: Number(e.target.value) || null })} required>
            <option value="">– válassz –</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}{p.country !== "HU" ? ` (${p.country})` : ""}</option>)}
          </select>
        </label>
        <label>{direction === "out" ? "Számlaszám" : "Szállítói számlaszám"}<input value={h.invoiceNumber} onChange={(e) => setH({ ...h, invoiceNumber: e.target.value })} required /></label>
        <label>Kelte<input type="date" value={h.issueDate} onChange={(e) => setH({ ...h, issueDate: e.target.value, fulfillmentDate: h.fulfillmentDate || e.target.value })} /></label>
        <label>Teljesítés (ÁFA)<input type="date" value={h.fulfillmentDate} onChange={(e) => setH({ ...h, fulfillmentDate: e.target.value })} /></label>
        <label>Fizetési határidő<input type="date" value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></label>
        <label>Fizetési mód
          <select value={h.paymentMethod} onChange={(e) => setH({ ...h, paymentMethod: e.target.value })}>
            <option value="transfer">átutalás</option><option value="cash">készpénz</option><option value="card">bankkártya</option>
          </select>
        </label>
        <label>Pénznem
          <select value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value })}>
            {["HUF", "EUR", "USD", "CHF", "GBP"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {h.currency !== "HUF" && (
          <label>Árfolyam (Ft / 1 {h.currency})
            <input className="num" value={h.exchangeRate} readOnly={!h.rateManual} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} />
            <span style={{ fontSize: 11 }}>{h.rateManual ? "kézi árfolyam" : rateMsg} · {rd.rule}</span>
          </label>
        )}
        {h.currency !== "HUF" && (
          <label style={{ alignSelf: "end", display: "flex", gap: 6 }} title="Csak ha az MNB nem érhető el, vagy eltérő árfolyamot kell alkalmazni.">
            <input type="checkbox" checked={h.rateManual} onChange={(e) => setH({ ...h, rateManual: e.target.checked })} /> Kézi árfolyam
          </label>
        )}
        <label style={{ alignSelf: "end", display: "flex", gap: 6 }} title="Áfa tv. 58. § – pl. havi bérleti díj, folyamatos szolgáltatás">
          <input type="checkbox" checked={h.periodic} onChange={(e) => setH({ ...h, periodic: e.target.checked })} /> Időszakos elszámolás
        </label>
      </div>

      <table className="lines">
        <thead>
          <tr>
            <th style={{ width: "22%" }}>Megnevezés</th>
            <th style={{ width: "16%" }}>Gépkocsi</th>
            <th style={{ width: "6%" }}>Menny.</th>
            <th style={{ width: "10%" }}>Egységár{hasMargin ? " (különb.: bruttó)" : ""}</th>
            <th style={{ width: "12%" }}>ÁFA-kód</th>
            <th style={{ width: "16%" }}>Ellenszámla</th>
            <th className="num">Nettó Ft</th>
            <th className="num">ÁFA Ft</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const p = preview.rows[i];
            return (
              <tr key={i}>
                <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td>
                  <select value={l.vehicleId ?? ""} onChange={(e) => pickVehicle(i, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">–</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </td>
                <td><input className="num" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><input className="num" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                <td>
                  <select value={l.vatCodeId} onChange={(e) => setLine(i, { vatCodeId: Number(e.target.value) })}>
                    {vatCodes.map((v) => <option key={v.id} value={v.id} title={v.name}>{v.code} – {v.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={l.accountId} onChange={(e) => setLine(i, { accountId: Number(e.target.value) })}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                </td>
                <td className="num">{p && "a" in p && p.a ? fmtHuf(p.a.netHuf) : <span className="muted">{p && "warn" in p ? p.warn : ""}</span>}</td>
                <td className="num">
                  {p && "a" in p && p.a ? fmtHuf(p.a.vatHuf) : ""}
                  {p && "marginBase" in p && p.marginBase !== null && p.marginBase !== undefined ? (
                    <div className="muted" style={{ fontSize: 11 }}>alap: {fmtHuf(p.marginBase)}</div>
                  ) : null}
                </td>
                <td><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>×</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}><button type="button" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Tétel</button></td>
            <td className="num">{fmtHuf(preview.net)}</td>
            <td className="num">{fmtHuf(preview.vat)}</td>
            <td></td>
          </tr>
          <tr>
            <td colSpan={6} className="num">Végösszeg (partner felé)</td>
            <td colSpan={2} className="num">{fmtHuf(preview.payable)} Ft</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {hasMargin && direction === "out" && (
        <p className="muted">
          Különbözeti adózás: az ÁFA = (bruttó eladási ár − beszerzési ár) × 27/127, negatív árrésnél 0. A számlán ÁFA nem kerül feltüntetésre,
          csak a „Különbözet szerinti szabályozás – használt cikkek” jelölés.
        </p>
      )}

      <label>Megjegyzés<textarea rows={2} value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></label>

      <div className="row">
        <button onClick={() => submit(false)} disabled={pending}>Mentés piszkozatként</button>
        <button className="primary" onClick={() => submit(true)} disabled={pending}>Mentés és könyvelés</button>
        {pending && <span className="muted">Mentés…</span>}
      </div>
    </div>
  );
}
