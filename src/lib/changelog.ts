/** v6.12.0 – Újdonságok: a felhasználóknak szóló, közérthető változásnapló (legfrissebb elöl). */
export type Release = { version: string; title: string; items: string[] };

export const CHANGELOG: Release[] = [
  { version: "7.3.0", title: "Fizetési emlékeztető és banki szabályok", items: [
    "Nyitott tételek: lejárt vevőszámlákra egy gombbal udvarias fizetési emlékeztető megy a partnernek (a számlák listájával, a nyitott összeggel és a bankszámlaszámmal).",
    "Banki szabályok: „ha a kivonat szövegében X szerepel, könyveld Y-ra” – az ismétlődő, számla nélküli tételek (NAV, bankköltség, kamat) maguktól könyvelődnek.",
  ] },
  { version: "7.2.0", title: "Mentés egy gombbal a tárolóba", items: [
    "Admin › Mentés: a „Mentés most” gomb az összes cég teljes mentését a fájltárolóba teszi; cégenként a legutóbbi 12 marad meg, bármelyik letölthető és visszatölthető.",
  ] },
  { version: "7.1.0", title: "Gyorsabb nyitóoldal, biztonságosabb feltöltés, jobb mobilnézet", items: [
    "A nyitóoldal, az Adók és a Napi összefoglaló nagy cégnél többszörösen gyorsabban töltődik be.",
    "A feltöltött bizonylatok közül csak a PDF és a kép nyílik meg a böngészőben; minden más fájl letöltésként érkezik.",
    "Telefonon a széles táblázatok önmagukban görgethetők, az oldal nem lóg ki.",
  ] },
  { version: "7.0.0", title: "Adatbiztonság és nagy listák", items: [
    "Az ügyfélfiókok adatai adatbázis-szinten is el vannak választva: egy cég könyvelése semmilyen módon nem hivatkozhat másik cég számlájára, partnerére vagy főkönyvi számlájára.",
    "Keresés és lapozás a Beérkező bizonylatok és a Partnerek listájában – nagy adatmennyiségnél sem vágódik le semmi.",
  ] },
  { version: "6.12.0", title: "Bemutató cég, súgó, újdonságok", items: [
    "Egy gombnyomással létrehozható bemutató cég valósághű mintaadatokkal – azonnal kipróbálható, és egy gombbal törölhető.",
    "Súgó: a menü „Súgó” gombja az éppen nyitott oldalhoz tartozó leírásra ugrik.",
    "Ez az oldal: az új funkciók egy helyen.",
  ] },
  { version: "6.11.0", title: "Jogosultságok és mobilos feltöltés", items: [
    "A kiegészítő modulok (pl. bérszámfejtés) felhasználónként elrejthetők.",
    "Új szerep: bizonylatfeltöltő – telefonról lefotózza és feltölti a számlát, a könyveléshez nem fér hozzá.",
    "Mobilos portál, ami kitehető a telefon kezdőképernyőjére.",
  ] },
  { version: "6.10.0", title: "Számlázóprogram-integráció", items: [
    "A számlázz.hu-ban és a Billingóban kiállított számlák maguktól bejönnek a Beérkező bizonylatok közé, pontos tételadatokkal és PDF-fel.",
  ] },
  { version: "6.9.0", title: "Könyvelőirodai nézet", items: [
    "Az összes cég határideje, nyitott ÁFA-időszaka, jóváhagyásra váró bizonylata és lejárt kintlévősége egy oldalon (Iroda).",
  ] },
  { version: "6.8.0", title: "Előfizetés", items: [
    "14 napos próbaidő, bankkártyás előfizetés (Stripe), számlák és kártyacsere az ügyfélkapuban.",
  ] },
  { version: "6.7.0", title: "Gyorsabb és megbízhatóbb működés", items: [
    "A bizonylatfájlok külön fájltárolóba kerülnek, a nagy listák lapozhatók.",
    "Megbízhatóbb e-mail küldés, automatikus hibanapló az üzemeltetőnek.",
  ] },
  { version: "6.6.0", title: "Évnyitás", items: [
    "Az évzárás után a nyitómérleg és a nyitó tételek automatikusan elkészülnek.",
  ] },
  { version: "6.5.0", title: "Könnyebb átállás", items: [
    "Első lépések oldal: nyitómérleg, nyitott számlák, partnerek és eszközök betöltése Excelből / CSV-ből.",
  ] },
  { version: "6.4.0", title: "Jogszabályi paraméterek", items: [
    "Az adó- és járulékkulcsok, minimálbér és egyéb paraméterek évenként karbantarthatók, a számítások mindig a hatályos értékkel dolgoznak.",
  ] },
  { version: "6.3.0", title: "Készletnyilvántartás", items: [
    "Cikktörzs, bevételezés, kiadás, csúsztatott átlagár és automatikus ELÁBÉ-könyvelés.",
  ] },
  { version: "6.2.0", title: "Modulok", items: [
    "A kiegészítő modulok cégenként be- és kikapcsolhatók – a menüben csak az látszik, amit használsz.",
  ] },
  { version: "6.1.0", title: "Adatbiztonság és mentés", items: [
    "A személyes adatok titkosítva tárolódnak; a teljes cég egy fájlba menthető és visszatölthető.",
  ] },
];

export const LATEST = CHANGELOG[0].version;
