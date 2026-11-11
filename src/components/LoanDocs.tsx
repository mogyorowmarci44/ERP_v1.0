/** Tagi kölcsön okiratok (A4 álló, a különbözeti ÁFA karton arculatával): TK szerződés, módosítás, TKV visszafizetés, egyenlegközlő. */
import type { LoanRow, LoanExtension } from "@/lib/member-loan-book";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { numberToHungarian } from "@/lib/hu-words";

export type DocCompany = { name: string; address: string | null; registrationNumber: string | null; taxNumber: string | null; representative: string | null; representativeTitle: string | null; signPlace: string | null };
export type DocMember = { name: string; address: string | null; taxNumber: string | null };

const CUR_HU: Record<string, string> = { EUR: "euró", USD: "amerikai dollár", CHF: "svájci frank", GBP: "angol font" };
const longDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const Blank = ({ w = 160 }: { w?: number }) => <span className="ld-blank" style={{ width: w }} />;
const val = (s: string | null | undefined, w?: number) => (s && s.trim() ? s : <Blank w={w} />);
const money = (huf: number, cur?: string | null, fx?: number | null) => (cur ? <>{fmtMoney(fx, cur)}<div className="mc-sub">{fmtHuf(huf)} Ft könyv szerinti érték</div></> : <>{fmtHuf(huf)} Ft</>);
const inWords = (huf: number, cur?: string | null, fx?: number | null) => (cur ? `${numberToHungarian(fx!)} ${CUR_HU[cur] ?? cur}` : `${numberToHungarian(huf)} forint`);
const repName = (c: DocCompany) => `${c.representative ?? "……………………"}, ${c.representativeTitle ?? "ügyvezető"}`;

function Head({ company, title, sub }: { company: DocCompany; title: string; sub: React.ReactNode }) {
  return (
    <header className="mc-head">
      <div>
        <div className="mc-company">{company.name}</div>
        <div className="mc-sub">{[company.address, company.registrationNumber ? `Cg. ${company.registrationNumber}` : null, company.taxNumber ? `adószám: ${company.taxNumber}` : null].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="mc-title">
        <h1>{title}</h1>
        <div className="mc-sub">{sub}</div>
      </div>
    </header>
  );
}

function Parties({ company, member }: { company: DocCompany; member: DocMember }) {
  return (
    <table className="mc-table ld-parties">
      <thead><tr><th>Kölcsönadó (tag)</th><th>Kölcsönvevő (társaság)</th></tr></thead>
      <tbody>
        <tr><td><strong>{member.name}</strong></td><td><strong>{company.name}</strong></td></tr>
        <tr><td>Lakcím: {val(member.address, 200)}</td><td>Székhely: {val(company.address, 200)}</td></tr>
        <tr><td>Születési hely, idő: <Blank w={170} /></td><td>Cégjegyzékszám: {val(company.registrationNumber, 120)}</td></tr>
        <tr><td>Anyja neve: <Blank w={200} /></td><td>Adószám: {val(company.taxNumber, 120)}</td></tr>
        <tr><td>Adóazonosító jel: {val(member.taxNumber, 120)}</td><td>Képviseli: {repName(company)}</td></tr>
      </tbody>
    </table>
  );
}

function Foot({ left, company, place, date, docId }: { left: [string, string]; company: DocCompany; place: string | null; date: string; docId: string }) {
  return (
    <>
      <p className="ld-kelt">Kelt: {place ? place : <Blank w={110} />}, {longDate(date)}</p>
      <footer className="mc-foot">
        <div className="mc-sign">{left[0]}, {left[1]}</div>
        <div className="mc-sign">{company.name}, {company.representativeTitle ?? "ügyvezető"}</div>
        <div className="mc-meta">{docId} · készült az MM ERP-ben</div>
      </footer>
    </>
  );
}

export function ContractSheet({ company, member, loan, moneyKind }: { company: DocCompany; member: DocMember; loan: LoanRow; moneyKind: "cash" | "bank" }) {
  const original = loan.originalDueDate ?? loan.dueDate!;
  return (
    <article className="mc-sheet ld-sheet">
      <Head company={company} title="Tagi kölcsönszerződés" sub={<>Szerződésszám: <strong>{loan.contractNo}</strong> · napló: {loan.number}</>} />
      <section className="mc-vehicle">
        <dl>
          <div><dt>Kölcsön összege</dt><dd>{money(loan.amount, loan.currency, loan.amountFx)}</dd></div>
          <div><dt>Folyósítás</dt><dd>{fmtDate(loan.date)} · {moneyKind === "cash" ? "készpénz" : "átutalás"}</dd></div>
          <div><dt>Lejárat</dt><dd>{fmtDate(original)}</dd></div>
          <div><dt>Kamat</dt><dd>kamatmentes</dd></div>
          <div><dt>Kölcsönadó</dt><dd>{member.name}</dd></div>
          <div><dt>Szerződésszám</dt><dd className="mono">{loan.contractNo}</dd></div>
        </dl>
      </section>

      <h2>1. Szerződő felek</h2>
      <Parties company={company} member={member} />

      <h2>2. Szerződési feltételek</h2>
      <ol className="ld-points">
        <li><strong>A kölcsön összege.</strong> A Kölcsönadó, mint a Kölcsönvevő tagja, a Kölcsönvevő részére <strong>{loan.currency ? fmtMoney(loan.amountFx, loan.currency) : `${fmtHuf(loan.amount)} Ft`}</strong>, azaz {inWords(loan.amount, loan.currency, loan.amountFx)} összegű tagi kölcsönt nyújt{loan.currency ? `, amelyet a Kölcsönvevő a folyósítás napi MNB-árfolyamon, ${fmtHuf(loan.amount)} Ft értéken vesz nyilvántartásba` : ""}.</li>
        <li><strong>Folyósítás.</strong> A kölcsön folyósítása {longDate(loan.date)} napján {moneyKind === "cash" ? "készpénzben, a Kölcsönvevő házipénztárába történő befizetéssel" : "átutalással, a Kölcsönvevő bankszámlájára"} történt. A Kölcsönvevő az összeg átvételét a szerződés aláírásával elismeri.</li>
        <li><strong>Kamat.</strong> A kölcsön kamatmentes; a Kölcsönadó kamatot, díjat vagy egyéb ellenszolgáltatást nem követel.</li>
        <li><strong>Visszafizetés.</strong> A Kölcsönvevő a kölcsönt legkésőbb <strong>{longDate(original)}</strong> napjáig köteles visszafizetni{loan.currency ? ` ${CUR_HU[loan.currency] ?? loan.currency} pénznemben` : ""}, egy összegben vagy részletekben, készpénzben vagy a Kölcsönadó által megadott bankszámlára. Előtörlesztés bármikor, díjmentesen lehetséges. Minden visszafizetésről sorszámozott (TKV) bizonylat készül.</li>
        <li><strong>Hosszabbítás.</strong> A lejárat a Felek írásbeli megállapodásával (sorszámozott szerződésmódosítás) meghosszabbítható; a módosítás a szerződés elválaszthatatlan része.</li>
        <li><strong>Egyéb.</strong> A szerződésben nem szabályozott kérdésekben a Polgári Törvénykönyvről szóló 2013. évi V. törvény kölcsönszerződésre vonatkozó rendelkezései az irányadók. A szerződés két egyező példányban készült.</li>
      </ol>
      <Foot left={[member.name, "kölcsönadó"]} company={company} place={company.signPlace} date={loan.date} docId={loan.contractNo ?? ""} />
    </article>
  );
}

export function AmendmentSheet({ company, member, loan, ext }: { company: DocCompany; member: DocMember; loan: LoanRow; ext: LoanExtension }) {
  const original = loan.originalDueDate ?? ext.fromDue;
  return (
    <article className="mc-sheet ld-sheet">
      <Head company={company} title="Tagi kölcsönszerződés módosítása" sub={<>{ext.seq}. számú módosítás · <strong>{ext.docNo}</strong></>} />
      <section className="mc-vehicle">
        <dl>
          <div><dt>Alapszerződés</dt><dd className="mono">{loan.contractNo}</dd></div>
          <div><dt>Kölcsön összege</dt><dd>{money(loan.amount, loan.currency, loan.amountFx)}</dd></div>
          <div><dt>Folyósítás</dt><dd>{fmtDate(loan.date)}</dd></div>
          <div><dt>Eredeti lejárat</dt><dd>{fmtDate(original)}</dd></div>
          <div><dt>Hosszabbítás</dt><dd>+{ext.days} nap</dd></div>
          <div><dt>Új lejárat</dt><dd className="strong">{fmtDate(ext.toDue)}</dd></div>
        </dl>
      </section>

      <h2>1. Szerződő felek</h2>
      <Parties company={company} member={member} />

      <h2>2. A módosítás</h2>
      <ol className="ld-points">
        <li><strong>Előzmény.</strong> A Felek között {longDate(loan.date)} napján {loan.contractNo} számon kamatmentes tagi kölcsönszerződés jött létre {loan.currency ? fmtMoney(loan.amountFx, loan.currency) : `${fmtHuf(loan.amount)} Ft`} összegben, eredetileg {longDate(original)} lejárattal{ext.seq > 1 ? `, amelyet a korábbi ${ext.seq - 1} módosítás ${longDate(ext.fromDue)} napjáig meghosszabbított` : ""}.</li>
        <li><strong>A lejárat módosítása.</strong> A Felek közös megegyezéssel a visszafizetési határidőt <strong>{ext.days} nappal</strong> meghosszabbítják: {longDate(ext.fromDue)} helyett <strong>{longDate(ext.toDue)}</strong>.</li>
        {ext.note && <li><strong>Megjegyzés.</strong> {ext.note}</li>}
        <li><strong>Változatlan rendelkezések.</strong> A szerződés egyéb rendelkezései változatlanul hatályosak; a kölcsön továbbra is kamatmentes.</li>
      </ol>

      <h2>3. A lejárat alakulása</h2>
      <table className="mc-table">
        <thead><tr><th>Okirat</th><th>Kelte</th><th className="num">Hosszabbítás</th><th>Lejárat</th></tr></thead>
        <tbody>
          <tr><td>{loan.contractNo} (eredeti szerződés)</td><td>{fmtDate(loan.date)}</td><td className="num">–</td><td>{fmtDate(original)}</td></tr>
          {loan.extensions.filter((e) => e.seq <= ext.seq).map((e) => (
            <tr key={e.seq} className={e.seq === ext.seq ? "ld-current" : undefined}><td>{e.docNo}</td><td>{fmtDate(e.extendedOn)}</td><td className="num">+{e.days} nap</td><td>{fmtDate(e.toDue)}</td></tr>
          ))}
        </tbody>
      </table>
      <Foot left={[member.name, "kölcsönadó"]} company={company} place={company.signPlace} date={ext.extendedOn} docId={ext.docNo} />
    </article>
  );
}

export function RepaymentSheet({ company, member, rep, loans, moneyKind }: { company: DocCompany; member: DocMember; rep: LoanRow; loans: LoanRow[]; moneyKind: "cash" | "bank" }) {
  const before = rep.balance + rep.amount;
  return (
    <article className="mc-sheet ld-sheet">
      <Head company={company} title="Tagi kölcsön visszafizetés" sub={<>Bizonylatszám: <strong>{rep.docNo}</strong> · napló: {rep.number}</>} />
      <section className="mc-vehicle">
        <dl>
          <div><dt>Visszafizetett összeg</dt><dd className="strong">{money(rep.amount, rep.currency, rep.amountFx)}</dd></div>
          <div><dt>Dátum</dt><dd>{fmtDate(rep.date)}</dd></div>
          <div><dt>Módja</dt><dd>{moneyKind === "cash" ? "készpénz (házipénztárból)" : "átutalás"}</dd></div>
          <div><dt>Átvevő (tag)</dt><dd>{member.name}</dd></div>
          <div><dt>Tartozás utána</dt><dd>{fmtHuf(rep.balance)} Ft</dd></div>
          <div><dt>Bizonylatszám</dt><dd className="mono">{rep.docNo}</dd></div>
        </dl>
      </section>

      <h2>1. Törlesztett kölcsönök</h2>
      <table className="mc-table">
        <thead><tr><th>Szerződés</th><th>Folyósítás</th><th className="num">Kölcsön</th><th className="num">Törlesztés</th><th className="num">Nyitott utána</th><th>Lejárat</th></tr></thead>
        <tbody>
          {rep.allocations.map((a) => {
            const l = loans.find((x) => x.entryId === a.loanEntryId);
            return (
              <tr key={a.loanEntryId}>
                <td>{a.contractNo}{!a.explicit && <div className="mc-sub">FIFO szerint</div>}</td>
                <td>{fmtDate(a.loanDate)}</td>
                <td className="num">{l ? (l.currency ? fmtMoney(l.amountFx, l.currency) : `${fmtHuf(l.amount)} Ft`) : "–"}</td>
                <td className="num">{a.amountFx != null ? fmtMoney(a.amountFx, rep.currency!) : `${fmtHuf(a.amount)} Ft`}</td>
                <td className="num">{a.openFxAfter != null ? fmtMoney(a.openFxAfter, rep.currency!) : `${fmtHuf(a.openAfter)} Ft`}{(a.openFxAfter ?? a.openAfter) <= 0.004 && <div className="mc-sub">rendezve</div>}</td>
                <td>{fmtDate(l?.dueDate)}</td>
              </tr>
            );
          })}
          {!rep.allocations.length && <tr><td colSpan={6} className="muted">Nem párosítható nyitott kölcsönhöz.</td></tr>}
        </tbody>
      </table>

      <h2>2. A tag felé fennálló tartozás</h2>
      <table className="mc-calc">
        <tbody>
          <tr><td>Tartozás a visszafizetés előtt</td><td className="op" /><td className="num">{fmtHuf(before)} Ft</td></tr>
          <tr><td>Visszafizetés ({rep.docNo})</td><td className="op">−</td><td className="num">{fmtHuf(rep.amount)} Ft</td></tr>
          <tr className="sum"><td>Tartozás a visszafizetés után</td><td className="op">=</td><td className="num">{fmtHuf(rep.balance)} Ft</td></tr>
        </tbody>
      </table>

      <h2>3. Nyilatkozat</h2>
      <p className="ld-text">
        Alulírott {member.name} igazolom, hogy a(z) {company.name}-tól {longDate(rep.date)} napján {rep.currency ? fmtMoney(rep.amountFx, rep.currency) : `${fmtHuf(rep.amount)} Ft`}, azaz {inWords(rep.amount, rep.currency, rep.amountFx)} összeget
        {moneyKind === "cash" ? " készpénzben átvettem" : " átutalással megkaptam"} a fenti tagi kölcsön(ök) visszafizetéseként.
      </p>
      <Foot left={[member.name, "kölcsönadó"]} company={company} place={company.signPlace} date={rep.date} docId={rep.docNo ?? ""} />
    </article>
  );
}

export function StatementSheet({ company, member, rows, asOf, balance, fx }: { company: DocCompany; member: DocMember; rows: LoanRow[]; asOf: string; balance: number; fx: Array<{ currency: string; balanceFx: number }> }) {
  const open = rows.filter((r) => r.kind === "loan" && r.status !== "Rendezve");
  const moves = rows.filter((r) => r.date.slice(0, 4) === asOf.slice(0, 4));
  return (
    <article className="mc-sheet ld-sheet">
      <Head company={company} title="Tagi kölcsön egyenlegközlő" sub={<>Fordulónap: <strong>{fmtDate(asOf)}</strong></>} />
      <section className="mc-vehicle">
        <dl>
          <div><dt>Tag</dt><dd>{member.name}</dd></div>
          <div><dt>Tartozás a tag felé</dt><dd className="strong">{fmtHuf(balance)} Ft</dd></div>
          <div><dt>Nyitott kölcsön</dt><dd>{open.length} db{fx.filter((f) => Math.abs(f.balanceFx) > 0.004).map((f) => ` · ${fmtMoney(f.balanceFx, f.currency)}`)}</dd></div>
        </dl>
      </section>
      <h2>1. Nyitott kölcsönök</h2>
      <table className="mc-table">
        <thead><tr><th>Szerződés</th><th>Folyósítás</th><th className="num">Összeg</th><th className="num">Nyitott</th><th>Eredeti lejárat</th><th>Lejárat</th></tr></thead>
        <tbody>
          {open.map((r) => (
            <tr key={r.entryId}>
              <td>{r.contractNo}</td><td>{fmtDate(r.date)}</td>
              <td className="num">{r.currency ? fmtMoney(r.amountFx, r.currency) : `${fmtHuf(r.amount)} Ft`}</td>
              <td className="num">{r.currency ? fmtMoney(r.openFx, r.currency) : `${fmtHuf(r.open)} Ft`}</td>
              <td>{fmtDate(r.originalDueDate)}</td>
              <td>{fmtDate(r.dueDate)}{r.extensions.length ? <div className="mc-sub">{r.extensions.length}× hosszabbítva</div> : null}</td>
            </tr>
          ))}
          {!open.length && <tr><td colSpan={6} className="muted">Nincs nyitott kölcsön.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={3}>Összesen</td><td className="num">{fmtHuf(open.reduce((s, r) => s + r.open, 0))} Ft</td><td colSpan={2} /></tr></tfoot>
      </table>
      <h2>2. {asOf.slice(0, 4)}. évi mozgások</h2>
      <table className="mc-table">
        <thead><tr><th>Dátum</th><th>Bizonylat</th><th>Jogcím</th><th className="num">Összeg</th><th className="num">Egyenleg</th></tr></thead>
        <tbody>
          {moves.map((r) => (
            <tr key={r.entryId}>
              <td>{fmtDate(r.date)}</td>
              <td>{r.kind === "loan" ? r.contractNo : r.kind === "repayment" ? r.docNo : r.number}</td>
              <td>{r.kind === "loan" ? "befizetés" : r.kind === "repayment" ? "visszafizetés" : "fordulónapi átértékelés"}</td>
              <td className="num">{fmtHuf(r.signed)} Ft</td>
              <td className="num">{fmtHuf(r.balance)} Ft</td>
            </tr>
          ))}
          {!moves.length && <tr><td colSpan={5} className="muted">Nem volt mozgás.</td></tr>}
        </tbody>
      </table>
      <p className="ld-text">Kérjük, hogy az egyenleget aláírásával igazolja, vagy eltérés esetén azt 8 napon belül jelezze.</p>
      <Foot left={[member.name, "tag"]} company={company} place={company.signPlace} date={asOf} docId={`Egyenlegközlő ${fmtDate(asOf)}`} />
    </article>
  );
}
