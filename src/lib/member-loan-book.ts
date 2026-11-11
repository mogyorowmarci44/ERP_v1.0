/**
 * Tagi kölcsön nyilvántartás – tiszta számítás (tesztelhető).
 *  - forintos kölcsön: a forintos visszafizetések FIFO-elven a legkorábbi nyitott befizetést csökkentik,
 *  - devizás kölcsön: a devizában történő visszafizetések FIFO-elven, devizában párosítva;
 *    a forint könyv szerinti érték tagonként és devizánként (átlagár), a fordulónapi átértékeléssel együtt.
 */
import { round2 } from "./money";
import { addDaysIso } from "./dates";

export type LoanExtension = { seq: number; extendedOn: string; days: number; fromDue: string; toDue: string; docNo: string; note: string | null };

export type LoanSourceRow = {
  entryId: number;
  date: string;
  number: string;
  description: string;
  sourceType: string | null;
  partnerId: number | null;
  partnerName: string | null;
  /** Követel − Tartozik a 4791-en (pozitív = nő a tartozás a tag felé). */
  signed: number;
  terms?: { dueDate: string; originalDueDate: string | null; contractNo: string | null; currency: string | null; amountFx: number | null; note: string | null } | null;
  /** member_loan_fx sor (devizás visszafizetés / átértékelés). */
  fx?: { kind: string; currency: string; amountFx: number; rate: number | null } | null;
  /** A tétel devizás pénzeszköz sora (pl. 3811 EUR pénztár). */
  moneyFx?: { currency: string; amountFx: number } | null;
  extensions?: LoanExtension[];
  /** Visszafizetésnél: TKV bizonylatszám, kifejezett párosítás (különben FIFO). */
  repayment?: { docNo: string | null; allocations: Array<{ loanEntryId: number; amount: number }> | null; note: string | null } | null;
};

/** Egy visszafizetés párosítása egy kölcsönhöz (amount forintban; devizásnál amountFx is), openAfter = a kölcsön nyitott része utána. */
export type LoanAllocation = { loanEntryId: number; contractNo: string | null; loanDate: string; amount: number; amountFx: number | null; openAfter: number; openFxAfter: number | null; explicit: boolean };

export type LoanStatus = "Rendezve" | "Nyitott" | "Hamarosan lejár" | "Lejárt" | "";

export type LoanRow = {
  entryId: number;
  date: string;
  number: string;
  description: string;
  kind: "loan" | "repayment" | "reval";
  /** Forintösszeg abszolút értéke. */
  amount: number;
  /** Előjeles forintösszeg (+ = nő a tartozás). */
  signed: number;
  currency: string | null;
  amountFx: number | null;
  contractNo: string | null;
  dueDate: string | null;
  originalDueDate: string | null;
  extensions: LoanExtension[];
  /** Befizetésnél a még vissza nem fizetett rész forintban (devizásnál könyv szerinti átlagáron). */
  open: number;
  /** Devizás befizetésnél a nyitott devizaösszeg. */
  openFx: number | null;
  status: LoanStatus;
  /** Futó egyenleg forintban. */
  balance: number;
  note: string | null;
  /** Visszafizetésnél (TKV) a bizonylatszám. */
  docNo: string | null;
  /** Visszafizetésnél: melyik kölcsön(ök)et törlesztette. */
  allocations: LoanAllocation[];
  /** Befizetésnél: mely visszafizetések törlesztették. */
  repaidBy: Array<{ entryId: number; docNo: string | null; date: string; amount: number; amountFx: number | null }>;
};

export type FxPool = { currency: string; balanceFx: number; bookHuf: number; avgRate: number | null };

export type MemberBook = {
  partnerId: number | null;
  name: string;
  rows: LoanRow[];
  received: number;
  repaid: number;
  revaluation: number;
  balance: number;
  overdue: number;
  dueSoon: number;
  openLoans: number;
  nextDue: string | null;
  fx: FxPool[];
};

const byDate = <T extends { date: string; entryId: number }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId - b.entryId);

export function buildLoanBook(src: LoanSourceRow[], asOf: string) {
  const soon = addDaysIso(asOf, 30);
  const byMember = new Map<string, { partnerId: number | null; name: string; rows: LoanRow[] }>();

  for (const r of [...src].sort(byDate)) {
    const key = String(r.partnerId ?? "nincs");
    if (!byMember.has(key)) byMember.set(key, { partnerId: r.partnerId, name: r.partnerName ?? "Partner nélkül", rows: [] });
    const signed = round2(r.signed);
    const isReval = r.sourceType === "member_loan_reval" || r.fx?.kind === "reval";
    const kind: LoanRow["kind"] = isReval ? "reval" : signed >= 0 ? "loan" : "repayment";
    let currency: string | null = null, amountFx: number | null = null;
    if (kind === "loan") { currency = r.terms?.currency ?? r.moneyFx?.currency ?? null; amountFx = r.terms?.amountFx ?? r.moneyFx?.amountFx ?? null; }
    else if (kind === "repayment") { currency = r.fx?.currency ?? r.moneyFx?.currency ?? null; amountFx = r.fx?.amountFx ?? r.moneyFx?.amountFx ?? null; }
    else { currency = r.fx?.currency ?? null; amountFx = 0; }
    if (currency && kind !== "reval" && !(amountFx != null && Math.abs(amountFx) > 0)) { currency = null; amountFx = null; }
    const exts = [...(r.extensions ?? [])].sort((a, b) => a.seq - b.seq);
    byMember.get(key)!.rows.push({
      entryId: r.entryId, date: r.date, number: r.number, description: r.description, kind,
      amount: Math.abs(signed), signed, currency, amountFx: amountFx != null ? Math.abs(amountFx) : null,
      contractNo: kind === "loan" ? r.terms?.contractNo ?? null : null,
      dueDate: kind === "loan" ? r.terms?.dueDate ?? null : null,
      originalDueDate: kind === "loan" ? r.terms?.originalDueDate ?? exts[0]?.fromDue ?? r.terms?.dueDate ?? null : null,
      extensions: kind === "loan" ? exts : [],
      open: kind === "loan" ? Math.abs(signed) : 0,
      openFx: kind === "loan" && currency ? Math.abs(amountFx!) : null,
      status: "", balance: 0, note: kind === "loan" ? r.terms?.note ?? null : kind === "repayment" ? r.repayment?.note ?? null : null,
      docNo: kind === "repayment" ? r.repayment?.docNo ?? null : null,
      allocations: [], repaidBy: [],
      _alloc: kind === "repayment" ? r.repayment?.allocations ?? null : null,
    } as LoanRow & { _alloc: Array<{ loanEntryId: number; amount: number }> | null });
  }

  const members: MemberBook[] = [...byMember.values()].map((m) => {
    let bal = 0;
    const pools = new Map<string, { fx: number; huf: number }>();
    const pool = (c: string) => { if (!pools.has(c)) pools.set(c, { fx: 0, huf: 0 }); return pools.get(c)!; };
    for (const r of m.rows) {
      bal += r.signed;
      r.balance = round2(bal);
      if (r.currency) { const p = pool(r.currency); p.huf += r.signed; p.fx += r.kind === "loan" ? r.amountFx! : r.kind === "repayment" ? -r.amountFx! : 0; }
      if (r.kind !== "repayment") continue;
      // 1) kifejezett párosítás, 2) a maradék FIFO (devizás a devizás, forintos a forintos kölcsönökön)
      const fxMode = !!r.currency;
      let rest = fxMode ? r.amountFx! : r.amount;
      const rate = fxMode && r.amountFx ? r.amount / r.amountFx : 1;
      const take = (l: LoanRow, want: number, explicit: boolean) => {
        const avail = fxMode ? l.openFx ?? 0 : l.open;
        const x = round2(Math.min(want, avail, rest));
        if (x <= 0.004) return;
        if (fxMode) l.openFx = round2(l.openFx! - x); else l.open = round2(l.open - x);
        rest = round2(rest - x);
        const huf = fxMode ? Math.round(x * rate) : x;
        r.allocations.push({ loanEntryId: l.entryId, contractNo: l.contractNo, loanDate: l.date, amount: huf, amountFx: fxMode ? x : null, openAfter: fxMode ? 0 : l.open, openFxAfter: fxMode ? l.openFx : null, explicit });
        l.repaidBy.push({ entryId: r.entryId, docNo: r.docNo, date: r.date, amount: huf, amountFx: fxMode ? x : null });
      };
      const eligible = (l: LoanRow) => l.kind === "loan" && l.date <= r.date && (fxMode ? l.currency === r.currency : !l.currency);
      for (const a of (r as LoanRow & { _alloc: Array<{ loanEntryId: number; amount: number }> | null })._alloc ?? []) {
        const l = m.rows.find((x) => x.entryId === a.loanEntryId);
        if (l && eligible(l)) take(l, a.amount, true);
      }
      for (const l of m.rows) {
        if (rest <= 0.004) break;
        if (eligible(l)) take(l, Infinity, false);
      }
    }
    const fx: FxPool[] = [...pools.entries()].map(([currency, p]) => ({
      currency, balanceFx: round2(p.fx), bookHuf: round2(p.huf), avgRate: Math.abs(p.fx) > 0.004 ? Math.round((p.huf / p.fx) * 10000) / 10000 : null,
    }));
    for (const r of m.rows) delete (r as Partial<LoanRow & { _alloc: unknown }>)._alloc;
    for (const r of m.rows) {
      if (r.kind !== "loan") continue;
      if (r.currency) {
        const p = fx.find((x) => x.currency === r.currency);
        r.open = round2((r.openFx ?? 0) * (p?.avgRate ?? r.amount / (r.amountFx || 1)));
      }
      const settled = r.currency ? (r.openFx ?? 0) <= 0.004 : r.open <= 0.004;
      r.status = settled ? "Rendezve" : r.dueDate && r.dueDate < asOf ? "Lejárt" : r.dueDate && r.dueDate <= soon ? "Hamarosan lejár" : "Nyitott";
    }
    const loans = m.rows.filter((r) => r.kind === "loan");
    const openLoans = loans.filter((r) => r.status && r.status !== "Rendezve");
    const sum = (xs: LoanRow[], f: (r: LoanRow) => number) => round2(xs.reduce((s, r) => s + f(r), 0));
    return {
      partnerId: m.partnerId, name: m.name, rows: m.rows, fx,
      received: sum(loans, (r) => r.amount),
      repaid: sum(m.rows.filter((r) => r.kind === "repayment"), (r) => r.amount),
      revaluation: sum(m.rows.filter((r) => r.kind === "reval"), (r) => r.signed),
      balance: round2(bal),
      overdue: sum(openLoans.filter((r) => r.status === "Lejárt"), (r) => r.open),
      dueSoon: sum(openLoans.filter((r) => r.status === "Hamarosan lejár"), (r) => r.open),
      openLoans: openLoans.length,
      nextDue: openLoans.map((r) => r.dueDate).filter((d): d is string => !!d && d >= asOf).sort()[0] ?? null,
    };
  });
  members.sort((a, b) => b.balance - a.balance);

  // napi egyenleg-idősor (összesen és tagonként) a grafikonhoz
  const all = members.flatMap((m) => m.rows.map((r) => ({ ...r, member: m.name }))).sort(byDate);
  const series: Array<{ date: string; total: number; byMember: Record<string, number> }> = [];
  const run: Record<string, number> = {};
  let total = 0;
  for (const r of all) {
    total = round2(total + r.signed);
    run[r.member] = round2((run[r.member] ?? 0) + r.signed);
    const last = series[series.length - 1];
    if (last && last.date === r.date) { last.total = total; last.byMember = { ...run }; }
    else series.push({ date: r.date, total, byMember: { ...run } });
  }

  // lejárati ütemezés: nyitott összegek a lejárat hónapja szerint (a lejártak külön)
  const ladder = new Map<string, number>();
  for (const m of members) for (const r of m.rows) {
    if (r.kind !== "loan" || r.status === "Rendezve" || r.open <= 0.004) continue;
    const k = !r.dueDate ? "nincs lejárat" : r.dueDate < asOf ? "lejárt" : r.dueDate.slice(0, 7);
    ladder.set(k, round2((ladder.get(k) ?? 0) + r.open));
  }
  const ladderRows = [...ladder.entries()].sort((a, b) => (a[0] === "lejárt" ? -1 : b[0] === "lejárt" ? 1 : a[0].localeCompare(b[0]))).map(([month, amount]) => ({ month, amount }));

  return {
    members,
    series,
    ladder: ladderRows,
    total: round2(members.reduce((s, m) => s + m.balance, 0)),
    overdue: round2(members.reduce((s, m) => s + m.overdue, 0)),
    dueSoon: round2(members.reduce((s, m) => s + m.dueSoon, 0)),
  };
}

/** Következő bizonylatszám: TK-ÉÉÉÉ-NNN (befizetés) / TKV-ÉÉÉÉ-NNN (visszafizetés), az adott év meglévő számai után. */
export function nextContractNo(existing: Array<string | null>, year: string, prefix = "TK"): string {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((m, c) => { const x = c ? re.exec(c) : null; return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

/** Hiányzó bizonylatszámok kiosztása időrendben (a meglévők megmaradnak). */
export function assignContractNos(loans: Array<{ entryId: number; date: string; contractNo: string | null }>, prefix = "TK"): Map<number, string> {
  const out = new Map<number, string>();
  const used = loans.map((l) => l.contractNo);
  for (const l of [...loans].sort(byDate)) {
    if (l.contractNo) continue;
    const no = nextContractNo(used, l.date.slice(0, 4), prefix);
    used.push(no);
    out.set(l.entryId, no);
  }
  return out;
}

/** Fordulónapi átértékelés különbözete: a devizaállomány MNB-árfolyamon − könyv szerinti érték (+ = nő a kötelezettség). */
export function revaluationDiff(pool: FxPool, rate: number): number {
  return round2(Math.round(pool.balanceFx * rate) - pool.bookHuf);
}

/** Devizás visszafizetés: a kötelezettség csökkenése az átlagáron, a pénztár csökkenése a pénztár átlagárán; a különbözet realizált. */
export function fxRepaymentSplit(amountFx: number, loanPool: FxPool, moneyAvgRate: number) {
  const loanHuf = Math.round(amountFx * (loanPool.avgRate ?? moneyAvgRate));
  const moneyHuf = Math.round(amountFx * moneyAvgRate);
  return { loanHuf, moneyHuf, diff: loanHuf - moneyHuf /* + = árfolyamnyereség, − = veszteség */ };
}
