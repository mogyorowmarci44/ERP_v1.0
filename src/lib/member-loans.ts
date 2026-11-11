/** Tagi kölcsön nyilvántartás: a 4791-es számla partnerenkénti tételei + szerződés, hosszabbítás, devizás kezelés. */
import { and, asc, eq, inArray, isNull, isNotNull, like } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { manualEntry, accountIdByCode, fxAccountBalance } from "./ledger";
import { today as todayFn, addDaysIso } from "./dates";
import { getMnbRate } from "./fx-service";
import { assignContractNos, buildLoanBook, fxRepaymentSplit, nextContractNo, revaluationDiff, type LoanSourceRow } from "./member-loan-book";

export { type LoanRow, type MemberBook, type LoanExtension } from "./member-loan-book";

export const MEMBER_LOAN_ACCOUNT = "4791";
const { journalLines, journalEntries, partners, memberLoanTerms, memberLoanExtensions, memberLoanFx, memberLoanRepayments, accounts } = schema;

async function loadSource(companyId: number): Promise<LoanSourceRow[]> {
  const acc = await accountIdByCode(db, companyId, MEMBER_LOAN_ACCOUNT);
  const rows = await db
    .select({
      entryId: journalEntries.id,
      date: journalEntries.date,
      number: journalEntries.number,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      partnerId: journalLines.partnerId,
      partnerName: partners.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(partners, eq(partners.id, journalLines.partnerId))
    // a sztornózott tételek és a stornók kimaradnak
    .where(and(eq(journalLines.accountId, acc), isNull(journalEntries.reversedById), isNull(journalEntries.reversalOfId)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.id));
  const ids = [...new Set(rows.map((r) => r.entryId))];
  if (!ids.length) return [];
  const [terms, fx, exts, money, reps] = await Promise.all([
    db.select().from(memberLoanTerms).where(inArray(memberLoanTerms.entryId, ids)),
    db.select().from(memberLoanFx).where(inArray(memberLoanFx.entryId, ids)),
    db.select().from(memberLoanExtensions).where(inArray(memberLoanExtensions.entryId, ids)),
    db.select({ entryId: journalLines.entryId, currency: journalLines.currency, amountFx: journalLines.amountFx })
      .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(inArray(journalLines.entryId, ids), isNotNull(journalLines.currency), like(accounts.code, "38%"))),
    db.select().from(memberLoanRepayments).where(inArray(memberLoanRepayments.entryId, ids)),
  ]);
  // egy tételen belül ugyanarra a tagra több 4791 sor is lehet – összevonjuk
  const merged = new Map<string, LoanSourceRow>();
  for (const r of rows) {
    const k = `${r.entryId}|${r.partnerId ?? ""}`;
    const signed = Number(r.credit) - Number(r.debit);
    const prev = merged.get(k);
    if (prev) { prev.signed += signed; continue; }
    const t = terms.find((x) => x.entryId === r.entryId);
    const f = fx.find((x) => x.entryId === r.entryId);
    const mf = money.find((x) => x.entryId === r.entryId);
    const rp = reps.find((x) => x.entryId === r.entryId);
    merged.set(k, {
      entryId: r.entryId, date: r.date, number: r.number, description: r.description, sourceType: r.sourceType,
      partnerId: r.partnerId, partnerName: r.partnerName, signed,
      terms: t ? { dueDate: t.dueDate, originalDueDate: t.originalDueDate, contractNo: t.contractNo, currency: t.currency, amountFx: t.amountFx != null ? Number(t.amountFx) : null, note: t.note } : null,
      fx: f ? { kind: f.kind, currency: f.currency, amountFx: Number(f.amountFx), rate: f.rate != null ? Number(f.rate) : null } : null,
      moneyFx: mf?.currency ? { currency: mf.currency, amountFx: Number(mf.amountFx ?? 0) } : null,
      repayment: rp ? { docNo: rp.docNo, allocations: rp.allocations ?? null, note: rp.note } : null,
      extensions: exts.filter((x) => x.entryId === r.entryId).map((x) => ({ seq: x.seq, extendedOn: x.extendedOn, days: x.days, fromDue: x.fromDue, toDue: x.toDue, docNo: x.docNo, note: x.note })),
    });
  }
  return [...merged.values()];
}

/** A hiányzó bizonylatszámok kiosztása időrendben: TK (befizetés) és TKV (visszafizetés) – idempotens. */
async function ensureContractNos(companyId: number, src: LoanSourceRow[]) {
  const isReval = (r: LoanSourceRow) => r.sourceType === "member_loan_reval" || r.fx?.kind === "reval";
  const loans = src.filter((r) => r.signed > 0 && !isReval(r) && r.terms).map((r) => ({ entryId: r.entryId, date: r.date, contractNo: r.terms!.contractNo }));
  for (const [entryId, no] of assignContractNos(loans, "TK")) {
    await db.update(memberLoanTerms).set({ contractNo: no }).where(and(eq(memberLoanTerms.entryId, entryId), isNull(memberLoanTerms.contractNo)));
    const r = src.find((x) => x.entryId === entryId);
    if (r?.terms) r.terms.contractNo = no;
  }
  const reps = src.filter((r) => r.signed < 0 && !isReval(r)).map((r) => ({ entryId: r.entryId, date: r.date, contractNo: r.repayment?.docNo ?? null }));
  for (const [entryId, no] of assignContractNos(reps, "TKV")) {
    await db.insert(memberLoanRepayments).values({ entryId, companyId, docNo: no }).onConflictDoNothing();
    const r = src.find((x) => x.entryId === entryId);
    if (r) r.repayment = { docNo: no, allocations: r.repayment?.allocations ?? null, note: r.repayment?.note ?? null };
  }
}

export async function memberLoans(companyId: number, asOf = todayFn()) {
  const src = await loadSource(companyId);
  await ensureContractNos(companyId, src);
  return buildLoanBook(src, asOf);
}

/** Egy kölcsön (befizetés) teljes adatai a szerződéshez. */
export async function memberLoan(companyId: number, entryId: number) {
  const book = await memberLoans(companyId);
  for (const m of book.members) {
    const r = m.rows.find((x) => x.entryId === entryId && x.kind !== "reval");
    if (r) return { member: m, loan: r };
  }
  return null;
}

/** Új tagi kölcsön befizetés vagy visszafizetés könyvelése (T pénzeszköz / K 4791, ill. fordítva). Devizás pénztárnál devizában. */
export async function recordMemberLoan(
  companyId: number,
  input: { partnerId: number; kind: "loan" | "repayment"; date: string; amount?: number | null; moneyAccountId: number; amountFx?: number | null; dueDate?: string | null; note?: string | null; targetLoanEntryId?: number | null },
  userId?: number,
) {
  if (input.kind === "loan" && !input.dueDate) throw new Error("Befizetéshez add meg a lejáratot.");
  if (input.kind === "loan" && input.dueDate! <= input.date) throw new Error("A lejárat legyen a befizetés napja után.");
  return db.transaction(async (tx: Tx) => {
    const loanAcc = await accountIdByCode(tx, companyId, MEMBER_LOAN_ACCOUNT);
    const [money] = await tx.select().from(accounts).where(and(eq(accounts.id, input.moneyAccountId), eq(accounts.companyId, companyId)));
    if (!money || !money.code.startsWith("38")) throw new Error("Pénzeszköz számlát (38x) kell választani.");
    const [p] = await tx.select().from(partners).where(and(eq(partners.id, input.partnerId), eq(partners.companyId, companyId)));
    if (!p) throw new Error("A tag nem található.");
    const isFx = money.currency !== "HUF";
    const amountFx = isFx ? input.amountFx ?? null : null;
    if (isFx && !(amountFx && amountFx > 0)) throw new Error(`A(z) ${money.code} ${money.currency} számlán a devizaösszeget kell megadni.`);
    const label = input.kind === "loan" ? "Tagi kölcsön befizetés" : "Tagi kölcsön visszafizetés";
    const desc = `${label} – ${p.name}${input.note ? ` (${input.note})` : ""}`;
    const journalCode = money.code.startsWith("381") ? "PE" : "BA";

    if (input.kind === "loan") {
      let huf = input.amount ?? 0;
      if (isFx && !(huf > 0)) huf = Math.round(amountFx! * (await getMnbRate(money.currency, input.date, tx)).rate);
      if (!(huf > 0)) throw new Error("Az összeg legyen pozitív.");
      const entry = await manualEntry(companyId, {
        journalCode, date: input.date, description: desc, sourceType: "member_loan",
        lines: [
          { accountId: money.id, partnerId: p.id, debit: huf, credit: 0, amountFx },
          { accountId: loanAcc, partnerId: p.id, debit: 0, credit: huf },
        ],
      }, userId, tx);
      const existing = await tx.select({ c: memberLoanTerms.contractNo }).from(memberLoanTerms).where(eq(memberLoanTerms.companyId, companyId));
      const contractNo = nextContractNo(existing.map((x) => x.c), input.date.slice(0, 4));
      await tx.insert(memberLoanTerms).values({
        entryId: entry.id, companyId, dueDate: input.dueDate!, originalDueDate: input.dueDate!, contractNo,
        currency: isFx ? money.currency : null, amountFx: isFx ? amountFx : null, note: input.note ?? null,
      });
      return entry;
    }

    // visszafizetés: TKV bizonylatszám; ha megadták, melyik kölcsönt törleszti (különben FIFO)
    const existingReps = await tx.select({ c: memberLoanRepayments.docNo }).from(memberLoanRepayments).where(eq(memberLoanRepayments.companyId, companyId));
    const docNo = nextContractNo(existingReps.map((x) => x.c), input.date.slice(0, 4), "TKV");
    const allocFor = (amt: number) => (input.targetLoanEntryId ? [{ loanEntryId: input.targetLoanEntryId, amount: amt }] : null);
    if (!isFx) {
      const huf = input.amount ?? 0;
      if (!(huf > 0)) throw new Error("Az összeg legyen pozitív.");
      const entry = await manualEntry(companyId, {
        journalCode, date: input.date, description: `${desc} – ${docNo}`, sourceType: "member_loan",
        lines: [{ accountId: loanAcc, partnerId: p.id, debit: huf, credit: 0 }, { accountId: money.id, partnerId: p.id, debit: 0, credit: huf }],
      }, userId, tx);
      await tx.insert(memberLoanRepayments).values({ entryId: entry.id, companyId, docNo, allocations: allocFor(huf), note: input.note ?? null });
      return entry;
    }
    // devizás visszafizetés: kötelezettség a tag devizás átlagárán, pénztár a pénztár átlagárán, különbözet realizált (976 / 876)
    const book = buildLoanBook(await loadSource(companyId), input.date);
    const pool = book.members.find((m) => m.partnerId === p.id)?.fx.find((x) => x.currency === money.currency);
    if (!pool || pool.balanceFx < amountFx! - 0.004) throw new Error(`${p.name} felé nincs ennyi ${money.currency} tartozás (nyitott: ${pool?.balanceFx ?? 0} ${money.currency}).`);
    const bal = await fxAccountBalance(tx, money.id, input.date);
    if (bal.fx < amountFx! - 0.004) throw new Error(`A(z) ${money.code} számlán nincs ennyi ${money.currency} (egyenleg: ${bal.fx}).`);
    const moneyRate = bal.huf / bal.fx;
    const split = fxRepaymentSplit(amountFx!, pool, moneyRate);
    const gain = await accountIdByCode(tx, companyId, "976");
    const loss = await accountIdByCode(tx, companyId, "876");
    const lines = [
      { accountId: loanAcc, partnerId: p.id, debit: split.loanHuf, credit: 0 },
      { accountId: money.id, partnerId: p.id, debit: 0, credit: split.moneyHuf, amountFx },
    ];
    if (split.diff > 0) lines.push({ accountId: gain, partnerId: p.id, debit: 0, credit: split.diff });
    if (split.diff < 0) lines.push({ accountId: loss, partnerId: p.id, debit: -split.diff, credit: 0 });
    const entry = await manualEntry(companyId, { journalCode, date: input.date, description: `${desc} – ${docNo}`, sourceType: "member_loan", lines }, userId, tx);
    await tx.insert(memberLoanRepayments).values({ entryId: entry.id, companyId, docNo, allocations: allocFor(amountFx!), note: input.note ?? null });
    await tx.insert(memberLoanFx).values({ entryId: entry.id, companyId, kind: "repayment", currency: money.currency, amountFx: amountFx!, rate: Math.round((split.loanHuf / amountFx!) * 1e6) / 1e6 });
    return entry;
  });
}

/** Hosszabbítás: a jelenlegi lejárathoz + N nap; szerződésmódosító okirat készül (sorszámmal). */
export async function extendLoan(companyId: number, entryId: number, input: { days: number; extendedOn: string; note?: string | null }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650) throw new Error("A hosszabbítás napjainak száma 1 és 3650 között legyen.");
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(memberLoanTerms).where(and(eq(memberLoanTerms.entryId, entryId), eq(memberLoanTerms.companyId, companyId))).for("update");
    if (!t) throw new Error("A kölcsönhöz nincs szerződés-adat (lejárat).");
    const exts = await tx.select().from(memberLoanExtensions).where(eq(memberLoanExtensions.entryId, entryId));
    const seq = exts.length + 1;
    const toDue = addDaysIso(t.dueDate, input.days);
    const contractNo = t.contractNo ?? `TK-${entryId}`;
    const docNo = `${contractNo}/M${seq}`;
    await tx.insert(memberLoanExtensions).values({ companyId, entryId, seq, extendedOn: input.extendedOn, days: input.days, fromDue: t.dueDate, toDue, docNo, note: input.note ?? null });
    await tx.update(memberLoanTerms).set({ dueDate: toDue, originalDueDate: t.originalDueDate ?? t.dueDate, updatedAt: new Date() }).where(eq(memberLoanTerms.entryId, entryId));
    return { seq, docNo, toDue };
  });
}

/** Az utolsó hosszabbítás visszavonása (pl. elírás) – a lejárat visszaáll. */
export async function undoLastExtension(companyId: number, entryId: number) {
  await db.transaction(async (tx) => {
    const exts = await tx.select().from(memberLoanExtensions).where(and(eq(memberLoanExtensions.entryId, entryId), eq(memberLoanExtensions.companyId, companyId))).orderBy(asc(memberLoanExtensions.seq));
    const last = exts[exts.length - 1];
    if (!last) throw new Error("Nincs visszavonható hosszabbítás.");
    await tx.delete(memberLoanExtensions).where(eq(memberLoanExtensions.id, last.id));
    await tx.update(memberLoanTerms).set({ dueDate: last.fromDue, updatedAt: new Date() }).where(eq(memberLoanTerms.entryId, entryId));
  });
}

/** Lejárat közvetlen beállítása (régi funkció, megmarad az importhoz / javításhoz). */
export async function setLoanDueDate(companyId: number, entryId: number, dueDate: string, note?: string | null) {
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
  if (!e) throw new Error("A tétel nem található.");
  await db
    .insert(memberLoanTerms)
    .values({ entryId, companyId, dueDate, originalDueDate: dueDate, note: note ?? null })
    .onConflictDoUpdate({ target: memberLoanTerms.entryId, set: { dueDate, note: note ?? null, updatedAt: new Date() } });
}

/**
 * Fordulónapi átértékelés (Szt. 60. §): a devizás tagi kölcsön állománya az adott napi MNB-árfolyamon.
 * Nő a kötelezettség: T 877 / K 4791; csökken: T 4791 / K 977.
 */
export async function revalueMemberLoans(companyId: number, date: string, userId?: number) {
  const src = await loadSource(companyId);
  if (src.some((r) => r.date === date && (r.sourceType === "member_loan_reval" || r.fx?.kind === "reval"))) throw new Error(`${date} napra már van átértékelés – előbb sztornózd a naplóban.`);
  const book = buildLoanBook(src, date);
  const loanAcc = await accountIdByCode(db, companyId, MEMBER_LOAN_ACCOUNT);
  const gain = await accountIdByCode(db, companyId, "977");
  const loss = await accountIdByCode(db, companyId, "877");
  const done: Array<{ member: string; currency: string; rate: number; diff: number }> = [];
  for (const m of book.members) {
    for (const pool of m.fx) {
      if (Math.abs(pool.balanceFx) < 0.005 && Math.abs(pool.bookHuf) < 1) continue;
      // csak a fordulónapig keletkezett tételek számítanak
      const { rate } = await getMnbRate(pool.currency, date);
      const diff = revaluationDiff(pool, rate);
      if (Math.abs(diff) < 1) continue;
      await db.transaction(async (tx) => {
        const lines = diff > 0
          ? [{ accountId: loss, partnerId: m.partnerId, debit: diff, credit: 0 }, { accountId: loanAcc, partnerId: m.partnerId, debit: 0, credit: diff }]
          : [{ accountId: loanAcc, partnerId: m.partnerId, debit: -diff, credit: 0 }, { accountId: gain, partnerId: m.partnerId, debit: 0, credit: -diff }];
        const e = await manualEntry(companyId, {
          journalCode: "VN", date, sourceType: "member_loan_reval",
          description: `Tagi kölcsön fordulónapi átértékelése – ${m.name}: ${pool.balanceFx} ${pool.currency} × ${rate} (MNB)`,
          lines,
        }, userId, tx);
        await tx.insert(memberLoanFx).values({ entryId: e.id, companyId, kind: "reval", currency: pool.currency, amountFx: 0, rate });
      });
      done.push({ member: m.name, currency: pool.currency, rate, diff });
    }
  }
  return done;
}

/** Tagi kölcsön mozgások egy adott napig (egyenlegközlőhöz). */
export async function memberLoansAsOf(companyId: number, asOf: string) {
  const src = (await loadSource(companyId)).filter((r) => r.date <= asOf);
  return buildLoanBook(src, asOf);
}

/** A befizetés pénzeszköze: készpénz (381x) vagy bank. */
export async function loanMoneyKind(companyId: number, entryId: number): Promise<"cash" | "bank"> {
  const [r] = await db.select({ code: accounts.code }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.companyId, companyId), like(accounts.code, "38%")));
  return r?.code.startsWith("381") ? "cash" : "bank";
}

/** Okiratokhoz: a cég és a tag adatai. */
export async function docParties(companyId: number, partnerId: number | null) {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const [p] = partnerId ? await db.select().from(partners).where(eq(partners.id, partnerId)) : [];
  return {
    company: { name: c.name, address: c.address, registrationNumber: c.registrationNumber, taxNumber: c.taxNumber, representative: c.settings.representative ?? null, representativeTitle: c.settings.representativeTitle ?? null, signPlace: c.settings.signPlace ?? null },
    member: { name: p?.name ?? "", address: p?.address ?? null, taxNumber: p?.taxNumber ?? null },
  };
}
