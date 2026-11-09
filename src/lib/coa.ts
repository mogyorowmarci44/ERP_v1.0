/**
 * Alapértelmezett magyar számlatükör egy használtautó-kereskedő / szerviz Kft-hez.
 * Cég létrehozásakor ez kerül betöltésre; utána szabadon bővíthető.
 * reportLine: a 2000. évi C. tv. szerinti mérleg / eredménykimutatás (összköltség eljárás, "A" változat) sorai.
 */
import type { CompanySettings } from "@/db/schema";

type AccType = "asset" | "liability" | "equity" | "expense" | "revenue" | "off_balance";
export type CoaRow = [code: string, name: string, type: AccType, reportLine?: string];

export const DEFAULT_COA: CoaRow[] = [
  // 1 – Befektetett eszközök
  ["1", "BEFEKTETETT ESZKÖZÖK", "asset"],
  ["114", "Vagyoni értékű jogok", "asset", "A.I.2"],
  ["115", "Szellemi termékek", "asset", "A.I.3"],
  ["119", "Immateriális javak értékcsökkenése", "asset", "A.I.3"],
  ["121", "Telkek, földterület", "asset", "A.II.1"],
  ["122", "Épületek, épületrészek", "asset", "A.II.1"],
  ["129", "Ingatlanok értékcsökkenése", "asset", "A.II.1"],
  ["131", "Termelő gépek, berendezések", "asset", "A.II.2"],
  ["139", "Műszaki gépek értékcsökkenése", "asset", "A.II.2"],
  ["141", "Üzemi (üzleti) gépek, berendezések", "asset", "A.II.3"],
  ["142", "Egyéb járművek", "asset", "A.II.3"],
  ["143", "Irodai, igazgatási berendezések", "asset", "A.II.3"],
  ["149", "Egyéb berendezések értékcsökkenése", "asset", "A.II.3"],
  ["161", "Befejezetlen beruházások", "asset", "A.II.4"],
  // 2 – Készletek
  ["2", "KÉSZLETEK", "asset"],
  ["211", "Alapanyagok, alkatrészek", "asset", "B.I.1"],
  ["261", "Kereskedelmi áruk – gépkocsik", "asset", "B.I.4"],
  ["262", "Kereskedelmi áruk – alkatrészek", "asset", "B.I.4"],
  ["269", "Kereskedelmi áruk értékvesztése", "asset", "B.I.4"],
  // 3 – Követelések, pénzeszközök, aktív időbeli elhatárolások
  ["3", "KÖVETELÉSEK, PÉNZESZKÖZÖK", "asset"],
  ["311", "Belföldi vevők", "asset", "B.II.1"],
  ["316", "Külföldi vevők", "asset", "B.II.1"],
  ["319", "Vevők értékvesztése", "asset", "B.II.1"],
  ["351", "Adott előlegek", "asset", "B.II.4"],
  ["361", "Munkavállalókkal szembeni követelések", "asset", "B.II.4"],
  ["362", "Költségvetési kiutalási igények", "asset", "B.II.4"],
  ["363", "Tulajdonosokkal szembeni követelések (tagi kölcsön adott)", "asset", "B.II.4"],
  ["368", "Különféle egyéb követelések", "asset", "B.II.4"],
  ["381", "Pénztár (HUF)", "asset", "B.IV.1"],
  ["3811", "Pénztár (EUR)", "asset", "B.IV.1"],
  ["384", "Elszámolási betétszámla (HUF)", "asset", "B.IV.2"],
  ["3841", "Devizaszámla (EUR)", "asset", "B.IV.2"],
  ["389", "Átvezetési számla", "asset", "B.IV.2"],
  ["391", "Bevételek aktív időbeli elhatárolása", "asset", "C.1"],
  ["392", "Költségek, ráfordítások aktív időbeli elhatárolása", "asset", "C.2"],
  // 4 – Források
  ["4", "FORRÁSOK", "liability"],
  ["411", "Jegyzett tőke", "equity", "D.I"],
  ["413", "Tőketartalék", "equity", "D.III"],
  ["414", "Eredménytartalék", "equity", "D.IV"],
  ["417", "Lekötött tartalék", "equity", "D.V"],
  ["419", "Adózott eredmény", "equity", "D.VII"],
  ["421", "Céltartalék a várható kötelezettségekre", "liability", "E.1"],
  ["443", "Hosszú lejáratú bankhitelek", "liability", "F.II.4"],
  ["451", "Rövid lejáratú kölcsönök", "liability", "F.III.2"],
  ["453", "Vevőktől kapott előlegek", "liability", "F.III.3"],
  ["454", "Belföldi szállítók", "liability", "F.III.4"],
  ["455", "Külföldi szállítók", "liability", "F.III.4"],
  ["461", "Társasági adó elszámolása", "liability", "F.III.8"],
  ["462", "Személyi jövedelemadó elszámolása", "liability", "F.III.8"],
  ["463", "Költségvetési befizetési kötelezettségek", "liability", "F.III.8"],
  ["466", "Előzetesen felszámított általános forgalmi adó", "liability", "F.III.8"],
  ["467", "Fizetendő általános forgalmi adó", "liability", "F.III.8"],
  ["468", "Általános forgalmi adó elszámolási számla", "liability", "F.III.8"],
  ["471", "Jövedelemelszámolási számla", "liability", "F.III.8"],
  ["479", "Különféle egyéb kötelezettségek", "liability", "F.III.8"],
  ["4791", "Tagi kölcsön (kapott)", "liability", "F.III.8"],
  ["481", "Bevételek passzív időbeli elhatárolása", "liability", "G.1"],
  ["482", "Költségek, ráfordítások passzív időbeli elhatárolása", "liability", "G.2"],
  ["491", "Nyitómérleg számla", "off_balance"],
  ["492", "Zárómérleg számla", "off_balance"],
  ["493", "Adózott eredmény elszámolása", "equity"],
  // 5 – Költségnemek
  ["5", "KÖLTSÉGNEMEK", "expense"],
  ["511", "Vásárolt anyagok költségei", "expense", "IV.5"],
  ["512", "Üzemanyag", "expense", "IV.5"],
  ["513", "Egyéb anyagköltség", "expense", "IV.5"],
  ["521", "Szállítási, rakodási költségek", "expense", "IV.6"],
  ["522", "Bérleti díjak", "expense", "IV.6"],
  ["523", "Javítási, karbantartási költségek", "expense", "IV.6"],
  ["524", "Hirdetés, reklám, propaganda költségei", "expense", "IV.6"],
  ["526", "Utazási és kiküldetési költségek", "expense", "IV.6"],
  ["528", "Telefon, internet, posta", "expense", "IV.6"],
  ["529", "Egyéb igénybe vett szolgáltatások (könyvelés, ügyvéd)", "expense", "IV.6"],
  ["531", "Hatósági, igazgatási díjak (forgalomba helyezés, eredetiség)", "expense", "IV.7"],
  ["532", "Pénzügyi, befektetési szolgáltatási díjak (bankköltség)", "expense", "IV.7"],
  ["533", "Biztosítási díjak", "expense", "IV.7"],
  ["541", "Bérköltség", "expense", "V.8"],
  ["551", "Személyi jellegű egyéb kifizetések", "expense", "V.9"],
  ["561", "Szociális hozzájárulási adó", "expense", "V.10"],
  ["571", "Terv szerinti értékcsökkenési leírás", "expense", "VI"],
  ["572", "Kisértékű eszközök egy összegű leírása", "expense", "VI"],
  // 8 – Értékesítés elszámolt önköltsége és ráfordítások
  ["8", "RÁFORDÍTÁSOK", "expense"],
  ["811", "Eladott áruk beszerzési értéke – alkatrész", "expense", "IV.7.ELÁBÉ"],
  ["814", "Eladott áruk beszerzési értéke – gépkocsi", "expense", "IV.7.ELÁBÉ"],
  ["815", "Eladott (közvetített) szolgáltatások értéke", "expense", "IV.7.ELSZ"],
  ["861", "Értékesített immateriális javak, tárgyi eszközök könyv szerinti értéke", "expense", "VIII"],
  ["865", "Bírságok, kötbérek, késedelmi kamatok", "expense", "VIII"],
  ["867", "Adók, illetékek (helyi iparűzési adó, cégautóadó)", "expense", "VIII"],
  ["869", "Különféle egyéb ráfordítások", "expense", "VIII"],
  ["872", "Fizetendő kamatok", "expense", "XV"],
  ["876", "Realizált árfolyamveszteség", "expense", "XV"],
  ["877", "Nem realizált árfolyamveszteség", "expense", "XV"],
  ["879", "Kerekítési különbözet (ráfordítás)", "expense", "VIII"],
  ["891", "Társasági adó", "expense", "XII"],
  // 9 – Bevételek
  ["9", "BEVÉTELEK", "revenue"],
  ["911", "Belföldi gépkocsi értékesítés árbevétele (különbözeti)", "revenue", "I.1"],
  ["912", "Belföldi gépkocsi értékesítés árbevétele (normál ÁFA)", "revenue", "I.1"],
  ["913", "Szerviz, javítás árbevétele", "revenue", "I.1"],
  ["914", "Alkatrész értékesítés árbevétele", "revenue", "I.1"],
  ["931", "Közösségen belüli értékesítés árbevétele", "revenue", "I.2"],
  ["932", "Export értékesítés árbevétele", "revenue", "I.2"],
  ["961", "Értékesített tárgyi eszközök ellenértéke", "revenue", "III"],
  ["969", "Különféle egyéb bevételek", "revenue", "III"],
  ["972", "Kapott kamatok", "revenue", "XIII"],
  ["976", "Realizált árfolyamnyereség", "revenue", "XIII"],
  ["977", "Nem realizált árfolyamnyereség", "revenue", "XIII"],
  ["979", "Kerekítési különbözet (bevétel)", "revenue", "III"],
];

/** Devizás pénzeszköz számlák devizaneme. */
export const ACCOUNT_CURRENCY: Record<string, string> = { "3811": "EUR", "3841": "EUR" };

/** Gyűjtőszámlák (1 jegyű) nem könyvelhetők. */
export const isPostingCode = (code: string) => code.length > 1;

export const DEFAULT_SETTINGS: CompanySettings = {
  receivableDomestic: "311",
  receivableForeign: "316",
  payableDomestic: "454",
  payableForeign: "455",
  inputVat: "466",
  outputVat: "467",
  vatSettlement: "468",
  inventoryGoods: "261",
  cogs: "814",
  fxGain: "976",
  fxLoss: "876",
  roundingAccount: "879",
};

export const DEFAULT_VAT_CODES: Array<{
  code: string;
  name: string;
  rate: number;
  kind: "normal" | "margin" | "exempt" | "out_of_scope" | "reverse_charge" | "eu_acquisition" | "eu_supply" | "export" | "non_deductible";
}> = [
  { code: "27", name: "27% általános", rate: 27, kind: "normal" },
  { code: "18", name: "18% kedvezményes", rate: 18, kind: "normal" },
  { code: "5", name: "5% kedvezményes", rate: 5, kind: "normal" },
  { code: "27NL", name: "27% – nem levonható (költség része)", rate: 27, kind: "non_deductible" },
  { code: "KÜL27", name: "Különbözeti adózás – használt cikk (27%)", rate: 27, kind: "margin" },
  { code: "AM", name: "Tárgyi adómentes", rate: 0, kind: "exempt" },
  { code: "TAH", name: "Áfa tv. hatályán kívüli", rate: 0, kind: "out_of_scope" },
  { code: "FAD27", name: "Fordított adózás 27%", rate: 27, kind: "reverse_charge" },
  { code: "KBB27", name: "Közösségen belüli beszerzés 27%", rate: 27, kind: "eu_acquisition" },
  { code: "KBE", name: "Közösségen belüli adómentes értékesítés", rate: 0, kind: "eu_supply" },
  { code: "EXP", name: "Export (harmadik ország)", rate: 0, kind: "export" },
];

export const DEFAULT_JOURNALS = [
  { code: "VE", name: "Vevőszámlák" },
  { code: "SZ", name: "Szállítói számlák" },
  { code: "BA", name: "Bank" },
  { code: "PE", name: "Pénztár" },
  { code: "VN", name: "Vegyes napló" },
];
