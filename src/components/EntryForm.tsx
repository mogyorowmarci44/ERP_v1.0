"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtHuf, parseNumber, round2 } from "@/lib/money";
import type { AccountOpt, PartnerOpt, VehicleOpt } from "@/lib/options";
import { manualEntryAction } from "@/app/c/[cid]/actions";

type Line = { accountId: number | ""; debit: string; credit: string; amountFx: string; description: string; partnerId: number | ""; vehicleId: number | "" };

const empty = (): Line => ({ accountId: "", debit: "", credit: "", amountFx: "", description: "", partnerId: "", vehicleId: "" });

export function EntryForm(props: { cid: number; accounts: AccountOpt[]; partners: PartnerOpt[]; vehicles: VehicleOpt[]; today: string }) {
  const { cid, accounts, partners, vehicles } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [journalCode, setJournal] = useState("VN");
  const [date, setDate] = useState(props.today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const num = (s: string) => {
    try { return parseNumber(s); } catch { return NaN; }
  };
  const td = round2(lines.reduce((s, l) => s + (num(l.debit) || 0), 0));
  const tc = round2(lines.reduce((s, l) => s + (num(l.credit) || 0), 0));
  const diff = round2(td - tc);

  const submit = () => {
    setError(null);
    start(async () => {
      const used = lines.filter((l) => l.accountId && (num(l.debit) || num(l.credit)));
      const res = await manualEntryAction(cid, {
        journalCode,
        date,
        description,
        lines: used.map((l) => ({
          accountId: Number(l.accountId),
          debit: num(l.debit) || 0,
          credit: num(l.credit) || 0,
          amountFx: num(l.amountFx) || null,
          description: l.description || description,
          partnerId: l.partnerId ? Number(l.partnerId) : null,
          vehicleId: l.vehicleId ? Number(l.vehicleId) : null,
        })),
      });
      if (res.error) setError(res.error);
      else router.push(`/c/${cid}/journal?ok=${encodeURIComponent("Tétel könyvelve.")}`);
    });
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {error && <div className="flash error">{error}</div>}
      <div className="card form-grid">
        <label>Napló
          <select value={journalCode} onChange={(e) => setJournal(e.target.value)}>
            <option value="VN">VN – Vegyes napló</option>
            <option value="BA">BA – Bank</option>
            <option value="PE">PE – Pénztár</option>
          </select>
        </label>
        <label>Dátum<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={{ gridColumn: "span 2" }}>Megnevezés<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="pl. Bankköltség október" /></label>
      </div>
      <table className="lines">
        <thead><tr><th style={{ width: "28%" }}>Főkönyvi számla</th><th className="num">Tartozik</th><th className="num">Követel</th><th className="num" title="Devizás pénzeszköz számlánál kötelező">Deviza összeg</th><th>Szöveg</th><th>Partner</th><th>Gépkocsi</th><th></th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">– számla –</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </td>
              <td><input className="num" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
              <td><input className="num" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
              <td>
                {(() => {
                  const a = accounts.find((x) => x.id === l.accountId);
                  return a && a.currency !== "HUF" ? (
                    <input className="num" placeholder={a.currency} value={l.amountFx} onChange={(e) => setLine(i, { amountFx: e.target.value })} />
                  ) : null;
                })()}
              </td>
              <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
              <td>
                <select value={l.partnerId} onChange={(e) => setLine(i, { partnerId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">–</option>
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>
                <select value={l.vehicleId} onChange={(e) => setLine(i, { vehicleId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">–</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </td>
              <td><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>×</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><button type="button" onClick={() => setLines((ls) => [...ls, empty()])}>+ Sor</button></td>
            <td className="num">{fmtHuf(td)}</td>
            <td className="num">{fmtHuf(tc)}</td>
            <td colSpan={5} style={{ color: diff === 0 ? "var(--ok)" : "var(--danger)" }}>{diff === 0 ? "Egyensúlyban" : `Eltérés: ${fmtHuf(diff)}`}</td>
          </tr>
        </tfoot>
      </table>
      <div className="row">
        <button className="primary" onClick={submit} disabled={pending || diff !== 0 || td === 0}>Könyvelés</button>
        {pending && <span className="muted">Mentés…</span>}
      </div>
    </div>
  );
}
