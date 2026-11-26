"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeLine, type VatKind } from "@/lib/posting";
import { fmtHuf, parseNumber } from "@/lib/money";
import type { AccountOpt, ItemOpt, PartnerOpt, VatOpt, VehicleOpt } from "@/lib/options";
import { saveInvoiceAction, getRateAction } from "@/app/c/[cid]/actions";
import { vatRateDate } from "@/lib/fx";
import { fmtDate } from "@/lib/dates";
import { cleanPartnerInput, findDuplicatePartner, type NewPartnerInput } from "@/lib/partner-input";

const NEW = "__new";
const emptyPartner = (): NewPartnerInput => ({ name: "", taxNumber: "", euVatNumber: "", country: "HU", address: "", email: "", isPrivatePerson: false });

type Line = { description: string; quantity: string; unitPrice: string; vatCodeId: number; accountId: number; vehicleId: number | null; itemId?: number | null };

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
  /** v6.3.0 – cikkek (csak bekapcsolt készlet-modulnál) */
  items?: ItemOpt[];
  initial: InvoiceFormInitial;
  invoiceId?: number;
  /** v2.0 – új sor alapértelmezései az entitás szerint (pl. magánszemélynél AAM / 27NL). */
  defaults?: { outVat: string; inVat: string; outAcc: string; inAcc: string };
  /** v2.2 – helyesbítő számla: az eredeti számla (partner, irány, pénznem rögzített). */
  corrects?: { id: number; number: string } | null;
}) {
  const { cid, direction, partners, accounts, vatCodes, vehicles } = props;
  const items = props.items ?? [];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState(props.initial);
  const [lines, setLines] = useState<Line[]>(props.initial.lines);
  /** v3.9.0 – új partner felvétele a számlán; null = meglévő partnert választ. A számla mentésekor kerül a Partnerek közé. */
  const [np, setNp] = useState<NewPartnerInput | null>(partners.length === 0 && !props.corrects ? emptyPartner() : null);
  const npCheck = useMemo(() => {
    if (!np) return null;
    try {
      const c = cleanPartnerInput(np);
      return { error: null as string | null, dup: findDuplicatePartner(partners, c) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), dup: undefined };
    }
  }, [np, partners]);

  const accByCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? accounts[0]?.id ?? 0;
  const vatByCode = (code: string) => vatCodes.find((v) => v.code === code)?.id ?? vatCodes[0]?.id ?? 0;
  const vatOf = (id: number) => vatCodes.find((v) => v.id === id);
  const vehOf = (id: number | null) => vehicles.find((v) => v.id === id);

  const newLine = (): Line => ({
    description: "",
    quantity: "1",
    unitPrice: "",
    vatCodeId: vatByCode(direction === "out" ? (props.defaults?.outVat ?? "27") : (props.defaults?.inVat ?? "27")),
    accountId: accByCode(direction === "out" ? (props.defaults?.outAcc ?? "913") : (props.defaults?.inAcc ?? "523")),
    vehicleId: null,
    itemId: null,
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

  /** v6.3.0 – cikk választásakor: beszerzésnél a cikk készletszámlája az ellenszámla, a megnevezés a cikk neve. */
  const pickItem = (i: number, id: number | null) => {
    const it = items.find((x) => x.id === id);
    const patch: Partial<Line> = { itemId: id };
    if (it) {
      if (direction === "in") patch.accountId = accByCode(it.stockAccount);
      if (!lines[i].description) patch.description = it.label;
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
    if (np && npCheck?.error) {
      setError(`Új partner: ${npCheck.error}`);
      return;
    }
    start(async () => {
      try {
        const res = await saveInvoiceAction(
          cid,
          {
            direction,
            partnerId: np ? 0 : Number(h.partnerId),
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
            correctsInvoiceId: props.corrects?.id ?? null,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: parseNumber(l.quantity),
              unitPrice: parseNumber(l.unitPrice),
              vatCodeId: l.vatCodeId,
              accountId: l.accountId,
              vehicleId: l.vehicleId,
              itemId: l.itemId ?? null,
            })),
          },
          props.invoiceId,
          postNow,
          np,
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
      {props.corrects && (
        <div className="flash ok">
          Helyesbítő számla a(z) <strong>{props.corrects.number}</strong> számlához. Csökkentésnél negatív egységárat (vagy mennyiséget) adj meg;
          különbözeti tételnél az ÁFA a gépkocsi új árréséből számolódik, ELÁBÉ / készletmozgás nem keletkezik. Teljes visszavonáshoz a sztornót használd.
        </div>
      )}
      <div className="card form-grid">
        <label>{direction === "out" ? "Vevő" : "Szállító"}
          <select
            value={np ? NEW : (h.partnerId ?? "")}
            onChange={(e) => {
              if (e.target.value === NEW) setNp(np ?? emptyPartner());
              else {
                setNp(null);
                setH({ ...h, partnerId: Number(e.target.value) || null });
              }
            }}
            required
            disabled={!!props.corrects}
          >
            <option value="">– válassz –</option>
            {!props.corrects && <option value={NEW}>+ Új partner…</option>}
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}{p.country !== "HU" ? ` (${p.country})` : ""}{p.taxNumber ? ` · ${p.taxNumber}` : ""}</option>)}
          </select>
        </label>
        {np && (
          <fieldset className="card" style={{ gridColumn: "1 / -1", margin: 0 }}>
            <legend>Új {direction === "out" ? "vevő" : "szállító"}</legend>
            <div className="form-grid">
              <label>Név<input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} required autoFocus /></label>
              <label>Ország (ISO)<input value={np.country ?? ""} maxLength={2} onChange={(e) => setNp({ ...np, country: e.target.value.toUpperCase() })} /></label>
              <label>
                {(np.country || "HU") === "HU" ? (np.isPrivatePerson ? "Adószám / adóazonosító jel (nem kötelező)" : "Adószám") : "Adószám (helyi)"}
                <input className="mono" value={np.taxNumber ?? ""} placeholder={(np.country || "HU") === "HU" ? "12345678-1-12" : ""} onChange={(e) => setNp({ ...np, taxNumber: e.target.value })} />
              </label>
              <label>Közösségi adószám<input className="mono" value={np.euVatNumber ?? ""} placeholder={(np.country || "HU") === "HU" ? "HU12345678" : "DE123456789"} onChange={(e) => setNp({ ...np, euVatNumber: e.target.value })} /></label>
              <label style={{ gridColumn: "span 2" }}>Cím<input value={np.address ?? ""} onChange={(e) => setNp({ ...np, address: e.target.value })} /></label>
              <label>E-mail<input type="email" value={np.email ?? ""} onChange={(e) => setNp({ ...np, email: e.target.value })} /></label>
              <label style={{ alignSelf: "end", display: "flex", gap: 6 }}>
                <input type="checkbox" checked={!!np.isPrivatePerson} onChange={(e) => setNp({ ...np, isPrivatePerson: e.target.checked })} /> Magánszemély
              </label>
            </div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {npCheck?.dup ? (
                <span>
                  Ez a partner már szerepel: <strong>{npCheck.dup.name}</strong>{npCheck.dup.taxNumber ? ` (${npCheck.dup.taxNumber})` : ""} – mentéskor a meglévőt használom.{" "}
                  <button type="button" onClick={() => { setH({ ...h, partnerId: npCheck.dup!.id }); setNp(null); }}>Meglévő kiválasztása</button>
                </span>
              ) : npCheck?.error && np.name.trim() ? (
                <span style={{ color: "var(--neg)" }}>{npCheck.error}</span>
              ) : (
                <span className="muted">A partner a számla mentésekor (piszkozat vagy könyvelés) kerül a Partnerek közé.</span>
              )}
            </div>
          </fieldset>
        )}
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
            <th style={{ width: "16%" }}>{items.length && vehicles.length ? "Gépkocsi / cikk" : items.length ? "Cikk" : "Gépkocsi"}</th>
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
                  {(vehicles.length > 0 || items.length === 0) && (
                    <select value={l.vehicleId ?? ""} onChange={(e) => pickVehicle(i, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">–</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  )}
                  {items.length > 0 && (
                    <select value={l.itemId ?? ""} onChange={(e) => pickItem(i, e.target.value ? Number(e.target.value) : null)} title="Cikk – készletmozgás">
                      <option value="">– cikk –</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.label} [{it.unit}]</option>)}
                    </select>
                  )}
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
