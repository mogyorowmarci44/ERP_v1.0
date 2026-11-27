/**
 * v6.12.0 – Súgó: rövid, gyakorlati leírás modulonként. A cég menüjében a „Súgó” link
 * az éppen nyitott oldalhoz tartozó részre ugrik (paths: az útvonal első szegmense a /c/[cid] után).
 */
export type HelpSection = { id: string; title: string; paths: string[]; body: string[] };

export const HELP: HelpSection[] = [
  { id: "kezdes", title: "Első lépések", paths: ["", "start"], body: [
    "Hozd létre a céget a Cégeim oldalon (vagy próbáld ki előbb a bemutató céget). A számlatükör, az ÁFA-kódok és a naplók automatikusan betöltődnek.",
    "A Törzsadatok › Első lépések oldalon tölthetők be a nyitó adatok: nyitómérleg, nyitott vevő- és szállítószámlák, partnerek, eszközök – Excel/CSV-ből.",
    "A nyitóoldal mutatja a teendőket: lejárt számlák, ÁFA-határidő, jóváhagyásra váró bizonylatok.",
  ] },
  { id: "szamlak", title: "Számlák", paths: ["invoices", "partners"], body: [
    "Új számla: Számlák › Új. A sorokhoz főkönyvi számlát és ÁFA-kódot választasz; a rendszer a partner korábbi számlái alapján javasol.",
    "A piszkozat még szabadon javítható; „Könyvelés” után a napló tételei elkészülnek. Könyvelt számlát sztornóval vagy helyesbítéssel lehet javítani.",
    "Kiegyenlítés: a számla oldalán „Rendezés” (bank, pénztár, devizaszámla), vagy a bankkivonat párosításakor automatikusan.",
    "Fizetési emlékeztető: Kimutatások › Nyitott tételek – partnerenként egy gombbal; a partner e-mail címe a Partnerek oldalon adható meg.",
  ] },
  { id: "bizonylatok", title: "Beérkező bizonylatok", paths: ["inbox"], body: [
    "Ide gyűlnek a számlák és kivonatok: feltöltésből, Gmailből / Drive-ból, a bankból (napi letöltés), a számlázóprogramból (számlázz.hu, Billingo) és a mobilos portálról.",
    "A „Beolvasás és könyvelés” gomb behozza az újakat, kiolvassa őket, és az egyértelműeket lekönyveli; a többi jóváhagyásra vár, a javaslattal együtt.",
    "Beállítások: forrás-kapcsolatok, automatikus könyvelés ki/be, számlázóprogram és bank összekapcsolása.",
    "Banki szabályok (Beállítások): ha a kivonat szövegében a megadott szó szerepel és nincs hozzá nyitott számla, a tétel a megadott főkönyvi számlára könyvelődik. Kivonat-tételnél a „+ szabály ebből” link előtölti.",
  ] },
  { id: "penz", title: "Bank, pénztár, deviza", paths: ["money", "fx"], body: [
    "A pénzmozgások (bank, pénztár, átvezetés) a Pénzügy › Pénztár és bank oldalon könyvelhetők; a bankkivonat soraiból a rendszer párosít a nyitott számlákkal.",
    "Devizás tételeknél az MNB-árfolyamot magától tölti; az árfolyamkülönbözetet az év végi átértékelés kezeli.",
  ] },
  { id: "afa", title: "ÁFA és bevallások", paths: ["filings", "taxes"], body: [
    "Az ÁFA-analitika a könyvelt számlákból készül. A NAV-bevallások oldalon az ÁFA- és járulékbevallás ÁNYK XML-be exportálható, amit az ÁNYK-ban nyitsz meg és küldesz be.",
    "Beküldés után zárd le az időszakot (Beállítások › Időszak lezárása), így utólag nem változhat.",
  ] },
  { id: "naplo", title: "Napló és főkönyv", paths: ["journal", "accounts"], body: [
    "Minden könyvelés naplótételként jelenik meg. Kézi tétel (pl. értékcsökkenés, átvezetés) a „Vegyes / bank tétel” oldalon rögzíthető – a tartozik és követel egyezése kötelező.",
    "Hibás tételt sztornóval (ellentétes tétellel) javíts; a lezárt időszak tételei nem módosíthatók.",
  ] },
  { id: "kimutatasok", title: "Kimutatások, évzárás", paths: ["reports", "closing", "value", "forecast", "summary"], body: [
    "Kimutatások: főkönyvi kivonat, eredménykimutatás, mérleg, cash flow, kintlévőségek – Excelbe exportálhatók.",
    "Évzárás: a zárási lépések (értékcsökkenés, átértékelés, adó, eredmény) sorban végigvihetők; utána az évnyitás a nyitómérleget automatikusan elkészíti.",
  ] },
  { id: "ber", title: "Bérszámfejtés", paths: ["payroll"], body: [
    "Dolgozók és jogviszonyok felvétele, majd havi számfejtés: a járulékok és az SZJA a hatályos jogszabályi paraméterek szerint számolódnak, a könyvelés automatikus.",
    "A járulékbevallás (08-as) a NAV-bevallások oldalon készül. A bérszámfejtés felhasználónként elrejthető (Beállítások › Felhasználók).",
  ] },
  { id: "keszlet", title: "Készlet (cikkek)", paths: ["inventory"], body: [
    "Cikktörzs, bevételezés és kiadás; az értékelés csúsztatott átlagáron történik, a havi ELÁBÉ könyvelése automatikus.",
  ] },
  { id: "gepkocsi", title: "Gépkocsik (különbözeti ÁFA)", paths: ["vehicles", "arsugo"], body: [
    "Minden gépkocsi saját kartont kap: beszerzés, aktivált költségek (pl. fényezés), eladás. A különbözeti ÁFA a kartonok alapján számolódik.",
  ] },
  { id: "eszkoz", title: "Tárgyi eszközök", paths: ["assets"], body: [
    "Eszköz felvétele aktiválással; a havi / éves értékcsökkenést a rendszer kiszámolja és lekönyveli.",
  ] },
  { id: "tagi", title: "Tagi kölcsön", paths: ["member-loans"], body: [
    "Tagi kölcsön nyilvántartása okirattal, hosszabbítással, devizában is; a kamat és a törlesztés könyvelése automatikus.",
  ] },
  { id: "beallitas", title: "Beállítások, modulok, felhasználók", paths: ["settings", "appearance", "import"], body: [
    "Modulok: a kiegészítő modulok (gépkocsi, készlet, bér, …) a cégnél egyenként be- és kikapcsolhatók.",
    "Felhasználók: tulajdonos (mindent lát és állít), könyvelő (könyvel), CEO – Ügyvezető (csak olvas), bizonylatfeltöltő (csak telefonról tölt fel bizonylatot). A kiegészítő modulok felhasználónként elrejthetők.",
  ] },
  { id: "mentes", title: "Mentés és export", paths: ["backup"], body: [
    "A teljes cég egy fájlba menthető (és visszatölthető). Archiválás előtt kötelező egy teljes mentés; a bizonylatokat 8 évig meg kell őrizni.",
  ] },
  { id: "elofizetes", title: "Előfizetés", paths: [], body: [
    "Az új ügyfélfiók 14 napos próbaidővel indul. Előfizetni az Admin › Előfizetés oldalon lehet (bankkártya, Stripe). Lejárt előfizetésnél az adatok megmaradnak és letölthetők, de csak olvashatók.",
    "A bemutató cég és a bizonylatfeltöltő felhasználók nem számítanak a csomag keretébe.",
  ] },
  { id: "iroda", title: "Könyvelőirodai nézet", paths: [], body: [
    "Ha több céged van, az Iroda oldalon egy helyen látod az összes cég határidejét, nyitott ÁFA-időszakát, jóváhagyásra váró bizonylatát és lejárt kintlévőségét.",
  ] },
];

/** A /c/[cid]/<szegmens>/… útvonalhoz tartozó súgórész azonosítója. */
export function helpFor(pathname: string): string {
  const seg = pathname.replace(/^\/c\/\d+\/?/, "").split("/")[0] ?? "";
  return HELP.find((h) => h.paths.includes(seg))?.id ?? "kezdes";
}
