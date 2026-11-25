# MM ERP

Többcéges, kettős könyvviteli ERP használtautó-kereskedéshez és szervizhez – számlafelviteltől az ÁFA analitikán és a gépkocsi készleten át a főkönyvi kivonatig.

**Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Drizzle ORM · PostgreSQL (Neon) · Render

## Ami már működik (1. mérföldkő – könyvelési mag)

| Terület | Funkció |
|---|---|
| Cégek | Több cég egy appban, cégenként külön főkönyv; felhasználók szerepkörrel (tulajdonos / könyvelő / csak olvasás) |
| Számlatükör | Magyar alap számlatükör betöltése cég létrehozásakor (1–9. számlaosztály, mérleg/EK sor-hozzárendeléssel), bővíthető |
| ÁFA-kódok | 27/18/5%, **különbözeti (használt cikk)**, AM, TAH, fordított adózás, KBB, KBE, export |
| Számlák | Vevő- és szállítói számla, piszkozat → könyvelés, devizás számla saját (banki) árfolyamon, sztornó |
| Különbözeti adózás | Tételes (gépkocsinkénti) árrés: ÁFA = (bruttó eladási ár − beszerzési ár) × 27/127, negatív árrésnél 0 |
| Gépkocsi készlet | Egyedi nyilvántartás; beszerzés + fényezés/javítás a 261-re aktiválva, eladáskor automatikus ELÁBÉ (T 814 / K 261), fedezet gépkocsinként |
| Árfolyamok | MNB hivatalos árfolyam automatikus letöltése, Áfa tv. 80. § / 63. § szerinti árfolyam-nap |
| Pénzügyi rendezés | Bank/pénztár (forint és deviza) kiegyenlítés, részfizetés, devizaszámla átlagár, realizált árfolyam-különbözet (976/876) |
| Főkönyv | Napló (VE, SZ, BA, PE, VN), vegyes tételek, piros storno, időszakzárás |
| Kimutatások | Eredménykimutatás (összköltség), cash-flow (indirekt), mérleg – napi / heti / havi / negyedéves bontásban, főkönyvi egyezőség-ellenőrzéssel |
| Riportok | Főkönyvi kivonat (analitikus / szintenként), számlakarton, nyitott tételek, ÁFA analitika (összesítő + különbözeti tételes) |
| Adatimport | Régi nyilvántartásból átalakított csomag betöltése üres cégbe, egy tranzakcióban (számlák, kiegyenlítések, gépkocsik, partnerek), egyeztető riporttal |
| Megjelenés | Cégenkénti logó és téma (12 kész téma, köztük sötétek, vagy egyedi színek), mobilbarát felület |

## v2.0 – Adószámos magánszemély (vendégház)

Új cég felvételekor választható a jogi forma: **társaság (Bt/Kft/Zrt)** vagy **adószámos magánszemély**.
A magánszemélynél is a kettős könyvelési motor fut a háttérben, de:

| Terület | Funkció |
|---|---|
| Számlatükör | Szálláshely-szolgáltatásra szabott: szállásdíj csatornánként (Airbnb / platform / közvetlen), rezsi, platform jutalék, takarítás, beszedett IFA (4631), magánszféra befizetés / kivét (4191/4192) |
| ÁFA | Alanyi mentes (AAM) kódok; alanyi mentesnél semmilyen beszerzési ÁFA nem vonható le – a fordított adózású platform-jutalék (FAD27) ÁFÁ-ja fizetendő (K 467), a költség része |
| Adók oldal | Tételes átalányadó negyedéves részletei és határidői, SZJA-módok összehasonlítása (tételes / 10% költséghányad / tételes költségelszámolás) éves vetítéssel, alanyi mentesség értékhatár-figyelő (2026: 20 M, 2027: 22 M, 2028-tól 24 M Ft), havi fordított ÁFA, gyanús platform-számlák jelzése |
| Bevételi-kiadási nyilvántartás | Pénzforgalmi nézet a bank / pénztár mozgásaiból, kategóriákkal, nyomtatható |
| Felület | Saját menü és áttekintés; mérleg, tagi kölcsön, gépkocsi készlet, forecast elrejtve |

Adózási profil (Beállítások): SZJA-mód, alanyi mentesség, szobák / férőhelyek, település, NTAK-azonosító, tételes adó / szoba, IFA tarifa, csatornák.

Következő lépések: foglalások / vendégéjszakák és IFA-összesítő, Airbnb-kifizetés import szabályok, saját weboldal foglalásainak fogadása.

## v5.1.1 – Nyitóoldal: forecast-cégérték a Cégérték alatt

- A nyitóoldal Cégérték csempéjén a korrigált nettó eszközérték alatt kisbetűvel ott a **forecast** szerinti cégérték is (könyv szerinti saját tőke + a Forecast következő 12 havi adózott eredményének jelenértéke, alap forgatókönyv) – mint az „Előző eladás óta” csempén a medián. Forecast-terv nélkül nem jelenik meg.
- Típuskatalógus (v4.5.3 pótlás): a kínai „AUDI” márka sorai kimaradnak a betöltésből; EPR-tömeg tartalék – ha a változatnak nincs saját tömege, a generáció, végül a modell évjáratban gyártott legnehezebb változata.

## v5.0.1 – Tevékenységprofil szerinti menü és nyitóoldal

- Általános profilnál (nem autókereskedés) elrejtve: **ÁrSugó, Gépkocsi készlet, KészletMérleg, AutóMérleg, Különbözeti ÁFA kartonok, EPR összesítő** – a bal menüből, a nyitóoldal gombjai és csempéi közül; a „gépkocsi 90 napja készleten” teendő sem jelenik meg.
- Nyitóoldal, általános profil: „Előző eladás óta” helyett **Bevétel (év)**, „Készlet” helyett **Nyitott vevők**.
- Beállítások: az EPR díjátalány és az EPR származáskód csak autókereskedés profilnál látszik (a mentett érték megmarad).
- Még nincs profilhoz kötve: a napi összefoglaló e-mail autós blokkja, a számlaűrlap gépkocsi-választója, a Forecast autónkénti részei.

## v5.0.0 – Kft sablon, tevékenységprofil

- Új cégnél választható **sablon**: *Általános Kft – tevékenységi kör még nem ismert* (alapértelmezés) vagy *Autókereskedés*. Egyelőre mindkettő ugyanazt kapja: üres cég, azonos számlatükör, ÁFA-kódok, naplók és felület.
- Új mező a cégen: **tevékenységprofil** (`car_dealer` / `general`), a Beállítások › Cégadatok alatt módosítható, a cégkártyán látszik. A meglévő társaságok autókereskedés profilt kapnak. Migráció: `0031_v5_0_activity_profile.sql`.
- Előkészítés: `isCarDealer()` (`src/lib/activity.ts`) – a következő lépésben ez rejti el általános profilnál az autós modulokat (ÁrSugó, AutóMérleg, KészletMérleg, jármű-EPR, különbözeti ÁFA alapértelmezés, autónkénti Forecast és KPI, napi e-mail autókészlet-blokkja).

## v4.5.3 – Típuskatalógus

- Új, cégfüggetlen táblák: `car_makes` (márka + hasznaltauto.hu hirdetésszám), `car_models`, `car_variants` (generáció, gyártás kezdete–vége évjárat-intervallumként, hajtáslánc, üzemanyag, hengerűrtartalom, kW / LE, motorkód, hajtás, váltó és fokozatszám, saját tömeg alsó–felső érték, megengedett össztömeg). Migráció: `0030_v4_5_3_car_catalog.sql`.
- Kör: a hasznaltauto.hu-n 200-nál több hirdetéssel rendelkező 44 márka (2026-11-25; a Mercedes-AMG a Mercedes-Benz alatt), minden modell és motorváltozat (forrás: auto-data.net).
- Admin › **Típuskatalógus**: az `autodata_tipusok.csv` betöltése (újratölthető, a változatok frissülnek); évjáratonkénti lekérdezés: `year_from ≤ év ≤ coalesce(year_to, idei év)`.

## v4.5.4 – Forecast › Készlet: új elrendezés, nyitott tételek a főkönyvből

- Készlet tábla: a könyv szerinti érték oszlop és a soronkénti Mentés gomb kikerült (alul egy „Összes mentése”). Fedezet-oszlopok: **Különbözeti ÁFA · EPR díj · Nettó fedezet**, alul összesítő sor.
- A nettó fedezet alatt az eltérés a **medián nettó fedezettől %-ban** (KPI, utolsó 12 hó eladásai): ±5%-on belül szürke, fölötte zöld ▲, alatta piros ▼; az egér alatt a forintos eltérés.
- Tervezett beszerzések: ugyanez a fedezet-blokk, soronkénti Mentés nélkül.
- Nyitott tételek (és az adatexport nyitott összege): a kiegyenlítés a rendezési tételek partnerszámla-soraiból (311 / 454) számolódik a számla devizájában – a más devizából fizetett számla (pl. forintos számla euróból) és a beszámított előleg már nem marad tévesen nyitva.

## v4.5.2 – Forecast: EPR díj a nettó fedezetben

- A Forecast autónkénti **nettó fedezete** = bruttó fedezet − **EPR díj**. Importautónál a díj: tömeg × az eladás tervezett napján érvényes díjtétel (az EPR-lap kategóriájával, hajtásával, átalány-beállításával); belföldi beszerzésnél 0.
- Az EPR díj az eladás napján költség (csökkenti az adózás előtti eredményt, a HIPA-alapot nem), befizetése a negyedévet követő hónap 20-án, utalással – a pénzszimulációban is.
- „Eladások a tervben” táblázat: új **EPR díj** oszlop; Tervezés › Készlet: a nettó fedezet az EPR díjjal csökkentve.
- Ha a díj nem számolható (hiányzó tömeg, kategória vagy származás), a Forecast jelzi; ha a tervköltségek között már szerepel EPR, nem számoljuk kétszer.
- A napi összefoglaló és az Évzárás éves Forecast-eredménye automatikusan az EPR-rel csökkentett értéket használja.

## v4.5.1 – Tagi kölcsön: Áttekintés fül, kijelölés és nyomtatás

- A „Minden mozgás” fül neve **Áttekintés**; a táblázat görgetés nélkül elfér (8 oszlop, a két lejárat egy oszlopban „régi → új”, a hosszabbító űrlap a Nyitott fülön marad).
- Soronkénti pipa: befizetésnél a szerződés (TK) és a módosítások (M1, M2…), visszafizetésnél a TKV; a címkék egyenként is kapcsolhatók, fölül „mind”.
- **Nyomtatás (N)** gomb: a kijelölt okiratok egyben, oldalanként (`/member-loans/print?d=…`).

## v4.5.0 – Tagok és tisztségviselők

- Beállítások › **Tagok és tisztségviselők**: táblázat (név, jogviszony, tulajdonrész, kitöltöttség) és oldalpanel három szakasszal – jogviszony (tag / ügyvezető, tulajdonrész, törzsbetét, kezdete–vége, képviselet), személyes adatok (születési hely és idő, anyja neve, lakcím, adóazonosító jel), kapcsolatok (tagi kölcsön partner). A tulajdonrészek összege legfeljebb 100%.
- A tagi kölcsön okiratok (szerződés, módosítás, visszafizetés, egyenlegközlő) innen töltődnek ki; a tag az összekötött partner, különben név szerint kerül elő – így az is működik, ha az ügyvezető maga ad tagi kölcsönt (tagként és ügyvezetőként is ő ír alá).
- Aláírósor: bal oldalon „<név>, tag”, jobb oldalon „<ügyvezető neve>, <Cég> Kft. ügyvezető”.
- Hosszabbítás: a módosítás kelte alapból a jelenlegi lejárat napja.
- Új tábla: `company_members` (migráció: `0029_v4_5_company_members.sql`).

## v4.4.0 – Tagi kölcsön: hány napja járt le

- A „Jelenlegi lejárat” alatt jelvény: „lejárt · N napja” – 1–30 nap sárga, 31–180 nap halványpiros, 180 nap felett telt piros; 30 napon belül lejárónál szürke „N nap múlva jár le”.
- A „Lejárt, vissza nem fizetett” csempén a legrégebbi lejárt kölcsön kora („legrégebbi: N napja”).

## v4.3.1 – EUR-pénztár naptár euróban

- Devizás pénztár- és bankjelentés naptárában a napi csempéken a nettó mozgás devizában (pl. „+700 €”, „−1,3 e €”), a színezés is ebből; a buborékban a deviza és a forintérték is.

## v4.3.0 – A napi összefoglaló és a Forecast éves eredménye egyezik

- A Forecast oldal alapból a **Teljes üzleti év** nézetben nyílik; a fő csempe itt a **Várható éves eredmény (tény + terv − HIPA)**, alatta a bontás és az adózás utáni összeg – pontosan az, amit a napi összefoglaló „Várható éves eredmény” sora mutat.
- A „Forecast időszak” és a „Kezdettől” nézet csempéje jelzi, hogy HIPA nélküli összeg.
- Napi összefoglaló: a várható éves eredmény alatt a bontás (tény + terv − HIPA · TAO · adózás után); az „Idén eddig” naptári üzleti évnél a Forecast „tény” része, a havi / negyedéves / éves eredmény a 89 (társasági adó) nélkül, a Forecasttal azonos módon.
- Az összefoglaló a Forecast folyó üzleti évét veszi (nem a naptári évet keresi).

## v4.2.0 – Napi összefoglaló: készpénz Ft és EUR külön

- A „Pénztár” csempe helyett két csempe: **Készpénz Ft** és **Készpénz EUR** (mai árfolyamon Ft-ban, alatta az euróösszeg), mindkettőnél a készpénzen belüli arány.
- Az „Összes pénz” csík háromszínű: Ft-készpénz · EUR-készpénz · bank.
- A rács 2 × 3: Készpénz Ft | Készpénz EUR, Bankszámla | Tegnapi bevétel, Készlet értéke | Eladó autó (átlagos állásidővel).
- A szöveges változat is bontja: készpénz Ft · készpénz EUR · bank.

## v4.1.0 – ERP-térkép a cégválasztó oldalon

- Új oldal: **/terkep**, a Cégeim oldal fejlécéből („ERP-térkép”), még cég vagy egység kiválasztása előtt. Az ERP 28 modulja metrótérképként: négy vonal (Bizonylat, Pénz, Készlet, Zárás és bér), a Napló a fő átszállóhely.
- Állomásra kattintva: leírás, funkciók, honnan kap adatot és hová adja tovább (kattintható), melyik verzióban jött, és „Megnyitás” gomb a felhasználó saját cégeihez (a vendégház modul az adószámos magánszemély egységekhez).
- Vonal kiemelése, „Egy használt autó útja” hatlépéses léptető lejátszással, kereshető modullista; mobilon oldalra húzható térkép.
- Bejelentkezéshez kötött; a sablon: `src/app/terkep/terkep.html` (önálló HTML, a cégek listája szerveroldalon kerül bele).

## v4.0.0 – Diagramok: adatok kiírása bárhol a diagram fölött

- Minden idősoros diagramon (Tervezés forgatókönyv-görbe, Pénz és bank egyenleg-görbék, tagi kölcsön egyenleg és lejárati ütemezés, vendégház vonaldiagramok) közös hover-réteg (`ChartHover`): a diagram **bármely pontja fölött** a legközelebbi időpontra ugrik – szaggatott függőleges vonal, kiemelt pontok (oszlopdiagramnál / lépcsős vonalnál a teljes sáv), és egy kártya az adott időpont összes értékével (forgatókönyvenként a hónap legalacsonyabb egyenlegével, tagi kölcsönnél az előző állapothoz képesti változással).
- Azonnal megjelenik (nem a böngésző kb. 1 másodperces súgója), a kártya mindig a kurzor felőli oldalra kerül, nem takarja ki az adatot.
- Telefonon koppintásra / húzásra is működik (a kártya felengedés után is látszik, máshová koppintva tűnik el); billentyűzettel a diagramra lépve ← → léptet, Esc bezár.
- Sankey (eredmény-folyam): a csomópontok és szalagok fölött ugyanilyen kártya – összeg, arány az árbevételből, kibontási tipp.
- A régi SVG `<title>` súgók kikerültek (nem jelenik meg két tooltip egyszerre); nyomtatásban a hover-réteg nem látszik.

## v3.10.0 – Napi automatikus banki letöltés (Erste, PSD2)

- Minden reggel 6:30-kor (GitHub Actions, `.github/workflows/bank-sync.yml` → `/api/bank-sync`) letölti az összekapcsolt bankszámlák **előző napig könyvelt** tételeit, és számlánként, naponként egy kivonatként a Beérkező bizonylatok közé teszi (forrás: „Bank (API)”). Innen ugyanaz a lánc fut, mint a feltöltött CSV / Excel kivonatnál: nyitott számla párosítás, bankköltség (532), pénztárból befizetés (381 → 389 → 384), a már könyvelt pénzmozgások kihagyása, az egyértelműek könyvelése, a többi jóváhagyásra vár. HUF számla → 384, EUR → 3841.
- Duplikáció ellen: a tranzakciók banki azonosítója (entry reference) a bizonylatban tárolva; 10 napra visszamenőleg újranéz, a későn könyvelt tétel külön kiegészítő kivonatként jön. A függőben lévő (még nem könyvelt) tételek kimaradnak.
- **Miért Enable Banking?** Az Erste Bank Hungary éles vállalati API-ja (`sapigtw.erstebank.hu/psd2/corporate`) csak MNB / EBA által engedélyezett harmadik fél szolgáltatónak (eIDAS-tanúsítvánnyal) érhető el. Az Enable Banking engedélyes számlainformációs szolgáltató; a **saját, összekapcsolt számlákhoz** („restricted” mód) díjmentes.
- A hozzájárulás legfeljebb 180 napig él; lejárat előtt 14 nappal figyelmeztet, utána a Beállításokban „Hozzájárulás megújítása” (George-jóváhagyás).

**Beállítás (egyszer):**
1. Regisztráció: [enablebanking.com](https://enablebanking.com) → Control Panel → *Applications* → új alkalmazás, környezet: **Production**. Redirect URL: `https://mm-erp.onrender.com/api/bank/callback`. A böngésző letölti a privát kulcsot (`<app-id>.pem`) – ezt őrizd meg.
2. Az alkalmazásnál *Activate by linking accounts* → Erste Bank (Magyarország) → jóváhagyás a George-ban. Ezzel aktív lesz „restricted” módban (csak ezek a számlák érhetők el).
3. Render → Environment: `EB_APP_ID` = az alkalmazás azonosítója, `EB_PRIVATE_KEY` = a `.pem` teljes tartalma, `APP_URL` = `https://mm-erp.onrender.com`.
4. ERP: Beérkező bizonylatok → Beállítások → **Bank** → Összekapcsolás a bankkal → George-jóváhagyás. Kezdőnap: amitől még nincs könyvelve banki tétel.
5. GitHub: az `ERP_URL` és `CRON_SECRET` titok már megvan (napi összefoglaló) – más nem kell. Kézi futtatás: Actions → *Napi banki letöltés* → Run workflow, vagy a Beállításokban „Letöltés most”.

## v3.9.8 – E-mail küldés HTTPS-en (Gmail-továbbító)

- A Render ingyenes csomagja 2025 szeptembere óta tiltja a kimenő SMTP-t, ezért a Próba és a napi küldés „connection timeout”-tal elakadt. Új küldési mód: a saját Gmail-fiókból egy Google Apps Script web app küld (`scripts/gmail-relay.gs`, beállítás a fájl elején); az ERP HTTPS-en adja át neki a levelet (`MAIL_RELAY_URL`, `MAIL_RELAY_SECRET`). Ha nincs beállítva, marad az SMTP – időtúllépésnél érthető hibaüzenettel.
- Ütemezett futásnál csak az a nap számít elvégzettnek, amelyen legalább egy levél kiment (hiba vagy üres címzettlista esetén a következő hívás újrapróbálja).
- A beállító oldalak figyelmeztetnek: nincs küldési mód / SMTP a Renderen / a cégnek van címzettje, de szünetel / egyetlen levél sem menne ki.
- Benne van a v3.9.7 (az `xlsx` csomag kivezetése) is, amely a main ágra eddig nem került be.

## v3.9.7 – Az `xlsx` csomag kivezetése

- A HIPA-szabályok (Kincstár HAKKA) beolvasása az ismert biztonsági hibás `xlsx` 0.18.5 helyett a már meglévő `exceljs`-szel (xlsx), illetve saját CSV-olvasóval (pontosvessző / vessző / tab, idézőjeles mezők, Windows-1250) történik. A zip és az xml változatlan.
- A régi bináris .xls / .ods fájlnál érthető üzenet: mentsd el xlsx-ként vagy csv-ként.
- `npm audit`: 0 sebezhetőség.

## v3.9.6 – Egyezőség, ÁFA-befizetés, kerekítés (a teljes körű ERP-teszt javításai)

- **Egyezőség** (Kimutatások › Egyezőség): 10 automatikus ellenőrzés – tételek egyensúlya, számla ↔ főkönyv, számlafej ↔ sorok, nyitott tételek ↔ 31x / 45x partnerenként, NAV ÁFA-befizetés helye, lezárt ÁFA-időszakba utólag könyvelt tétel, pénztár (fillér / negatív), gépkocsi készlet ↔ 261, sztornózott könyvelésű számla, duplikált partner. Javító gombok: *ÁFA-zárások újraszámolása*, *Partnerek összevonása*, *Egyértelmű párosítások elvégzése*. A hibák a nyitóoldal és a napi összefoglaló teendői közé is bekerülnek.
- **ÁFA-befizetés a 468-ra:** a pénzeszköz (38x) ellenében a 467-re könyvelt tétel automatikusan a 468-at terheli – így az ÁFA-zárás „fizetendő” összege nem torzul.
- **ÁFA-zárások újraszámolása:** a meglévő zárótételek időrendben újraszámolva (pl. utólag könyvelt tétel vagy átkönyvelés után), minden változás a tétel-naplóban.
- **Kézi ÁFA-tételek a bevallásban:** a számla nélkül, kézzel könyvelt 466 / 467 tételek (pl. visszáru-jóváírás) az ÁFA analitikában és az ÁNYK-bevallásban (M-lappal) is szerepelnek – a bevallás így egyezik a főkönyvvel.
- **Készpénz 5 Ft-os kerekítése:** forintos, készpénzes számla pénztárból történő kiegyenlítésénél az átadott összeg 0 / 5 Ft-ra kerekül, a különbözet 979 / 879; a kerekített összeg megadása teljes kiegyenlítésnek számít.
- **Fordított adózás / KBB:** a számlasor bruttója a partner felé fizetendő (= nettó), egyezően a számlafejjel (meglévő sorok a migrációval).
- **Pontosabb kerekítés:** a 2 tizedesre kerekítés előjel-szimmetrikus és a lebegőpontos hibáktól mentes.
- **Adatbázis-szintű védelem:** egy sorban csak Tartozik vagy Követel; kiegyensúlyozatlan tétel nem kerülhet be (tranzakció végén ellenőrzött trigger).
- **Gyorsabb:** az ÁFA-zárás lista 24 helyett 3 lekérdezés; a felhasználó és a cég kérésenként egyszer töltődik.
- **Egyszeri adatjavítások** (`scripts/data-fixes.ts`, a migráció után automatikusan, egyszer): ÁFA-befizetések 467 → 468 és a zárások újraszámolása; kézi tétellel rendezett számlák párosítása; duplikált partnerek összevonása; pénztár fillér-maradványának kerekítése; elavult bér-piszkozat törlése; kiállítás előtti határidők; lejárt ÁFA-időszakok zárása; időszakzárás a beszámolós évekre.
- Függőségek: nodemailer 10.6, uuid 11 (biztonsági javítások); a build DATABASE_URL nélkül is lefut.

## v3.9.5 – Készlet értéke, színezett eredmények

- Napi összefoglaló fejléce 2 × 2 kiemelt számmal, egységes stílusban: Pénztár (Ft) és Összes pénz e Ft-ban 1 tizedesre, Tegnapi bevétel forintra, **Készlet értéke** M Ft-ban 2 tizedesre – a készleten lévő autók beszerzési ára × (1 + medián bruttó fedezet %, elmúlt 12 hónap eladásaiból), alatta a beszerzési ár.
- Az eredmény-sorok előjel szerint színezve: pozitív zöld, nulla sárga, negatív piros (a várható éves eredmény is).
- A lejárt vevői tartozás mellett a lejárt szállítói tartozás is szerepel.

## v3.9.4 – Napilap stílusú napi összefoglaló, rontott számla

- **Új dizájn** („napilap”): a cég neve a fejlécben, természetes magyar szövegek (Összefoglaló, Eredmény, Teendők, Határidők, Autók, Tegnapi egyéb történések). A holding e-mail ugyanebben a stílusban („Mogyorosi Holding”, tulajdonosi összefoglaló).
- **Ügyvezetői összefoglaló új adatai:** Pénztár (Ft), összes pénz napi (MNB) értéken, eredmény ebben a hónapban / negyedévben / idén eddig + várható éves eredmény a Forecast alapján (és hány százaléka van már meg), a következő ÁFA- és járulékbevallás határideje (munkaszüneti nap esetén a következő munkanap).
- **Kihagyott autók:** a cég Napi összefoglaló oldalán bejelölhető, mely autók ne szerepeljenek (a szándékosan készleten tartott Jaguar a migrációval bekerül). Az időbeli elhatárolások nem szerepelnek az összefoglalóban.
- **Rontott számla:** piszkozat „Rontottnak jelölés” gombbal – nem könyvelhető, nem teendő, a listában „rontott” címkével marad (sorszám-folytonosság). A meglévő rontott papírszámla (megjegyzés alapján) a migrációval automatikusan rontott lesz.
- **Javítás:** a piszkozat-teendő a megfelelő irányú (vevő / szállítói) számlalistára visz, és a szövege megmondja, melyik fajta.

## v3.9.3 – Napi összefoglaló be / ki kapcsolása

- **Fő kapcsoló** (Admin › Napi összefoglaló): kikapcsolva semmilyen összefoglaló nem megy ki – sem az ütemezett, sem a „Küldés most”; a címzettek és beállítások megmaradnak.
- **Holding kapcsoló** és **cégenkénti kapcsoló** ugyanott egy táblában; a cég kapcsolója a cég saját *Napi összefoglaló* oldalán is elérhető (írási joggal).
- A kapcsolók az `app_settings.dailySummary` kulcsban (`enabled`, `holdingEnabled`, `disabledCompanies`), migráció nem kell.

## v3.9.2 – Napi összefoglaló e-mail

- Minden nap 6:59-kor (Budapest) e-mail a tegnapi napról és a mai állapotról.
- **Cégszintű jelentés** (Rendszer › Napi összefoglaló): címzettenként választható változat – *Ügyvezető* (számok, teendők, autókészlet), *Pénzügyes* (számok, teendők, pénzügyi napló + a tegnapi napló CSV-ben), *Teljes* (mind). Előnézet változatonként, próbaküldés, szüneteltetés.
- **Holding jelentés** (Admin › Napi összefoglaló): minden cég egyben – összesítő számok, cégenkénti tábla, 14 napos fedezettség (pénz vs. 46x adótartozás + esedékes szállítók), összes teendő cégnévvel, autók sávonként, tagi kölcsönök, vendégház. Címzettek csak itt állíthatók.
- Teendők: be nem küldött / esedékes ÁFA- és járulékbevallás, negatív pénztár, lejárt vevők / szállítók, beérkező bizonylatok, piszkozatok, le nem zárt ÁFA-időszak, elhatárolás, következő ÁFA-határidő.
- Küldés SMTP-n (alapból Gmail alkalmazásjelszóval). Ütemezés: GitHub Actions (`.github/workflows/daily-summary.yml`, 04:59 és 05:59 UTC) hívja a `/api/daily-summary` végpontot `CRON_SECRET`-tel; az ERP naponta egyszer küld, 6:45 és 12:00 között az első hívásra.
- Beállítás: Render → `MAIL_RELAY_URL`, `MAIL_RELAY_SECRET` (Gmail-továbbító, lásd `scripts/gmail-relay.gs`), `CRON_SECRET`; GitHub → Actions secrets: `ERP_URL`, `CRON_SECRET`. Az `SMTP_USER` / `SMTP_PASS` csak fizetős Render-csomagon működik (az ingyenes tiltja a kimenő SMTP-t).

## v3.9.1 – Dinamikus időszakválasztó

- Új közös `PeriodPicker`: a nézet bontásához illeszkedő naptár – Napi: két havi naptár, Heti: hetek (hétszámmal), Havi: két év hónapjai, Negyedéves: három év negyedévei, Éves: évrács. Két kattintás (kezdő és záró egység) és már frissül, nincs külön „Frissítés”.
- Gyorsválasztók a bontáshoz (pl. Ez a hónap, Előző negyedév, Elmúlt 12 hónap, Tavaly); ‹ / › a teljes tartományt a saját hosszával lépteti (egész hónap / negyedév / év egységben). Kijelzi az oszlopszámot, és figyelmeztet, ha több, mint ami elfér.
- Kimutatások és Pénztár és bank: új **Éves** bontás; bontásváltáskor a beállított időszak megmarad (az új egységre kerekítve), ha elfér.
- Dátumszűrős oldalak (Számlák, Napló, Főkönyvi karton, Főkönyvi kivonat, Pénztárkönyv, ÁFA analitika – havi naptárral, Különbözeti kartonok, KészletMérleg Eladott, bank/pénztár napi nézet): a két dátummező helyett ugyanez a választó; a többi szűrő megmarad.
- Vendégház (Áttekintés, P&L, Cash-flow, Foglalások): a ‹ év › léptető helyett egy kattintásos hét / hónap / negyedév / év választó.

## v3.9.0 – Új partner a vevő- és szállítói számlán

- Az Új vevőszámla / Új szállítói számla (és a piszkozat szerkesztése) Vevő / Szállító listájában „+ Új partner…”: név, ország, adószám, közösségi adószám, cím, e-mail, magánszemély.
- Az új partner a számla mentésekor (piszkozat vagy könyvelés) a számlával egy tranzakcióban kerül a Partnerek közé – ha a mentés hibára fut, partner sem jön létre.
- Adószám-ellenőrzés: magyar cégnél kötelező, `12345678-1-12` alakra normalizálva, törzsszám-ellenőrző számjeggyel és ÁFA-kóddal (1–5); magánszemélynél elhagyható, adóazonosító jel is megadható; külföldinél a közösségi adószám országkóddal kezdődik.
- Duplikáció-szűrés: azonos törzsszám / közösségi adószám (adószám nélkül azonos név) esetén figyelmeztet, és a meglévő partnert használja új felvétele helyett. Ugyanez az ellenőrzés a Partnerek oldalon is.

## v3.8.2 – „Beküldve” gomb az ÁNYK Exportban

- Az ÁNYK Export minden hónapjánál (ÁFA és járulék) „Beküldve” gomb: ha a hónapnak van betöltött változata, a legutolsót jelöli beküldöttnek; ha nincs (vagy ÁFA-önellenőrzés), az ERP által előállított XML-t eltárolja változatként (`…_ERP.xml`), és azt jelöli. Fájlt betölteni nem kell hozzá.
- A 2608 minta nem lehet ERP által előállított XML.

## v3.8.1 – ÁNYK Export szűrő: ÁFA / Járulék

- Az ÁNYK Export fülön szűrő: „ÁFA-bevallás” vagy „Járulékbevallás” (a fül- és szűrőnevekben nincs nyomtatványszám). Mindkettő ugyanonnan tölthető le: hónaponként XML és egy közös ZIP-végpont (`/filings/export/zip?kind=vat|payroll`).
- 2608 nézet: hónapok jogviszonnyal, határidő, állapot, TB / szocho / SZJA / befizetendő, „2608 XML”; a ZIP-ben a be nem küldött (hiányzó / esedékes) hónapok + összesítő CSV.

## v3.8.0 – 2608 járulékbevallás export

- A NAV-bevallások › Járulék (2608) fülön hónaponként „2608 XML” letöltés. A minta a cég legutóbb betöltött, ÁNYK-ban kitöltött 2608 bevallása (személyes adatok, jogviszony-kód, FEOR); az időszakot és az összegeket (TB-járulék 18,5%, szocho 13%, a 2026-os szabály szerint 112,5% nélkül) a Bérszámfejtés adja.
- `build2608Sheets`: időszak-csere, összegek a 2608M (626/629/633., 385/386. sor) és a 2608A (28., 31., 103., 109., 160. sor) lapokon; a rejtett ÁNYK-segédmezők kimaradnak.
- Import-XML: 2608M-nél `munkavallalo` (név + adóazonosító) blokk, sablonverzió 6.0.

## v3.7.7 – ÁNYK import-XML sablonverzióval

- Útmutató a lapon: ÁNYK › Adatok › XML állomány ellenőrzése és átadása elektronikus beküldésre (Ctrl+D).
- Az import-XML sablonverziót kap (2565: 4.0, 2665: 2.0), így az ÁNYK nem kérdez rá a verzióra. Kísérleti ÁNYK-mentés (`.frm.enyk`) `?format=enyk`-kel; az M-lapok rejtett számított mezői nélkül az ÁNYK üresnek látja őket, ezért alapból maradt az XML.


## v3.7.6 – 108. sor h oszlop

- A 108. sor h oszlopa (levonásba helyezett adó) az M-főlapok 07. sorának g oszlopából kitöltve (ÁNYK R177).

## v3.7.5 – ÁNYK import javítás

- Az ÁNYK-ba importálható XML-ben a mezőkód „n_” előtag nélkül szerepel, a dinamikus lapok (pl. M-lapok számlasorai) kódjában pedig az `XXXX` helyére a lap sorszáma kerül (`0B0001…`, `0B0002…`). Eddig az ÁNYK „Érvénytelen mezőkód”, majd „A sablon nem tartalmazza” hibával nem töltötte be.
- Az M-lap alnyomtatványok `albizonylatazonositas` blokkot kapnak (partner adószáma és neve).
- 105–109. sor az ÁNYK számítása szerint: a 105/108. sor a partnerenként ezer Ft-ra kerekített M-főlap összegek összege, a 106. sor b–e oszlopa 0-val kitöltve, 2665-nél a 105. sor „levonásba helyezett” (h) oszlopa is (a 108. h ugyanez, a 106. h üres), az M-főlap 07. sorában is a g oszlop, és a 109. sor (c; e csak ha a 108 e nem több a 109 c-nél).

## v3.7.4 – ÁNYK import: dinamikus lapok

- Az import-XML-ben a dinamikus lapok mezőkódjában az `XXXX` helyére a lap sorszáma kerül.
- Az alapbevallásból a dinamikus lapokat nem másoljuk át (az M-lapokat újra előállítjuk).

## v3.7.3 – Fülnevek

NAV-bevallások: „ÁFA (2565 / 2665)” → **ÁFA-bevallás**, „ÁFA az ERP-ből (önellenőrzés)” → **ÁNYK Export**.

## v3.7.2 – M-lap: a számla teljes áfája

Részben levonható számlánál (levonható + nem levonható sor ugyanazon a számlán) az M-lapra a számla teljes adóalapja és áthárított áfája kerül, a ténylegesen levont rész a 27%-os „f3” oszlopba (2665), összesítve a főlap „e3” oszlopába – a NAV útmutatója szerint.

## v3.7.1 – M-lap ellenőrzés

NAV-bevallások › **M-lap ellenőrzés**: a beadott M-lapok számlái az ERP könyvelésével összevetve – (1) levonható áfa adószám nélküli partnertől, (2) számlaszám-eltérés (írásmód, ill. partner + összeg alapján párosítva, link a számlára), (3) korábban levonva, az ERP-ben nem levonható / TAH, (4) a beadott M-lapon szerepel, az ERP-ben nincs meg.

## v3.7.0 – ÁFA-bevallás és önellenőrzés az ERP-ből (2565 / 2665)

NAV-bevallások › **ÁNYK Export** (korábban „ÁFA az ERP-ből”). A NAV kitöltési útmutatója és mezőazonosító-táblázata alapján.

| Terület | Funkció |
|---|---|
| Sorok a könyvelésből | Különbözeti adózás (használt cikk) a **09. sorba**, kiemelve az **50. sorban** (adóalap = bruttó eladási ár − beszerzési ár, adó nélkül; negatív árrés 0); 27/18/5% értékesítés 05–07.; levonható 64–66.; Közösségen belüli beszerzés 12–14. és 69.; 36., 76., 82–86. sor; ezer forintra kerekítve |
| M-lapok | Partnerenként (törzsszám) a levonásba helyezett számlák forintban, lapnként 36 sor; 105./108. sor összesítő; adószám nélküli partnernél figyelmeztetés. „Partner-adószámok az M-lapokról”: a beadott bevallások M-lapjairól pótolja a hiányzó adószámokat (név szerint) |
| Lánc | Időrendben: az előző hónap (helyes) 86. sora a következő 82. sorába |
| Önellenőrzés | A mérvadó beadott változathoz képest: jelleg O, 82–86. sor b = beadott, c = helyes; 04. lap: pótlékalap (útmutató szerinti esetek, göngyölítésnél 05-ös ok), pótlék, kötelezettség növekedés / csökkenés, ismételt önellenőrzésnél X; fejadatok (ügyintéző, bankszámla, gyakoriság) a beadott bevallásból |
| Önellenőrzési pótlék | Naponta a jegybanki alapkamat 365-öd része (ismételtnél ×1,5), a határidőt követő naptól a benyújtás napjáig, a kamatváltozások szerint szakaszolva |
| Letöltés | Időszakonként XML (önellenőrzés, vagy eredeti, ha még nincs beadva), illetve egy ZIP időrendben + összesítő CSV |
| Jelölés | „Mindenhol a legutolsó ment be” – egy gombbal |

## v3.6.0 – NAV-bevallások (ÁNYK): nyilvántartás, határidők, átviteli lánc

Új oldal: Pénzügy › **NAV-bevallások (ÁNYK)**.

| Terület | Funkció |
|---|---|
| ÁNYK-motor | Az ÁNYK mentett nyomtatványainak (`.frm.enyk`) és XML-jeinek beolvasása, illetve ÁNYK-ba importálható XML előállítása (Adatok › Import) – minden nyomtatványra ugyanaz a motor (`src/lib/anyk.ts`) |
| Betöltés | Több fájl vagy egy ZIP az `abevjava/mentesek` mappáról; csak a cég saját ÁFA- (2565 / 2665) és járulékbevallásai (2608) kerülnek be, a többit (TAO, HIPA, más adózó) kihagyja, ugyanaz a fájl kétszer nem töltődik be |
| Változatok | Időszakonként az összes mentés: eredeti / önellenőrzés / helyesbítés, mentés és aláírás ideje, KR-állomány neve, ÁFA eredménysorok (82–86., ezer Ft), M-lapok száma; „Ez ment be” jelölés (+ érkeztetési szám); XML-letöltés |
| Mérvadó változat | A legutolsó beküldöttnek jelölt – ennek híján a legutolsó mentés („nem megerősített”); ehhez képest számol majd az önellenőrzés |
| Átviteli lánc | Ha az előző hónap 86. sorában átvihető követelés van, annak a következő hónap 82. sorában kell szerepelnie – az eltéréseket kiemeli |
| Határidő-naptár | ÁFA havonta a tárgyhót követő hó 20-a, 2608 a 12-e (munkaszüneti napnál a következő munkanap); állapot: beküldve / nem jelölve / esedékes / hiányzik |
| Járulék (2608) | Azokra a hónapokra, amikor a Bérszámfejtésben élő jogviszony van: SZJA, TB-járulék (a társas vállalkozó minimumjárulékából a cég által viselt rész külön), szocho, befizetendő összesen. Az XML-kitöltéshez egy beadott 2608 `.frm.enyk` kell mintának (a mezőkódokhoz) |

## v3.5.1 – Tartási költség javaslat a könyvelésből

AutóMérleg › Tartási költség › **Javaslat a könyvelésből** (az elmúlt 12 hónap, ill. a működés kezdete óta):

| Érték | Számítás |
|---|---|
| Fix napi költség (Ft/nap/autó) | 522 bérleti díjak + 524 hirdetés, reklám + 533 biztosítás (az autóhoz rendelt tételek nélkül) ÷ (átlagos készlet darabszám × napok) |
| Lekötött pénz (%/év) | Pénz költsége: 872 kamatok évesítve ÷ átlagosan lekötött készletérték, de legalább 5,5% (alternatív hozam: a jegybanki alapkamat, 2026. november) + árvesztés: a Forecast-tervvel eladott autók tervezett ártól való elmaradásának napi üteme évesítve (medián; 3 autó alatt 3% ráhagyás) |

A „Javaslat átvétele” beírja a két mezőbe, a „Mentés a cég alapértékeként” menti.

## v3.5.0 – KészletMérleg: az összes AutóMérleg egy helyen

Új oldal: Járművek › **KészletMérleg** (menü, illetve gomb a Gépkocsi készletnél). Ugyanazzal a számolóval fut végig minden autón, mint az AutóMérleg, így a számok egyeznek az autók lapjával.

| Terület | Funkció |
|---|---|
| Készlet fül (sávok) | Lekötött pénz, napi tartási költség, várható nettó fedezet összesen; három oszlop: **Beavatkozni** (az ár a nullszaldó alatt, vagy N napon belül eléri – N állítható, alap 20), **Cél alatt**, **Rendben**. Kártyánként napok, ár (Forecast-terv, ennek híján az ÁrSugó javasolt ára), mini ársáv, napok a nullszaldóig; a piros kártyákon ÁrSugó (előtöltve) és AutóMérleg gomb |
| Eladott fül (dashboard) | Időszak (elmúlt 12 hónap, idei, tavalyi, egyéni) és csoportosítás (márka / modell, import / belföld, hónap). KPI-k: darab, bruttó és nettó fedezet, fedezet %, medián nettó fedezet, medián napi fedezet; **„Hová folyt el a fedezet?”** vízesés (Forecast-terv → költségeltérés → áreltérés → tény); pontdiagram (állásidő × nettó fedezet, mediánvonalakkal); legjobb / leggyengébb 5 napi fedezet szerint; teljes táblázat a tervtől való eltéréssel |
| Export | Excel (Készlet és Eladott munkalap, Mogyorosi Holding fejléccel), PDF / nyomtatás |
| Kezdőlap | KészletMérleg gomb és AutóMérleg-választó (készleten lévő autók) a gyorsgombok között; KészletMérleg link a Kimutatások és a Törzsadatok csempén; a „régóta készleten” teendő is ide visz |

## v3.4.1 – Elnevezés: bruttó és nettó fedezet

Mindenhol: **Fedezet I → Bruttó fedezet** (nettó árbevétel − vételár), **Fedezet II → Nettó fedezet** (nettó árbevétel − teljes bekerülési érték). Érinti: KPI-Dashboard, AutóMérleg, ÁrSugó, Forecast, Gépkocsi készlet.

## v3.4.0 – AutóMérleg: egy autó teljes mérlege

Új oldal autónként (Gépkocsi készlet › az autó neve vagy „AutóMérleg”, illetve a kartonról), az ÁrSugó mintájára.

| Terület | Funkció |
|---|---|
| Készleten (élő számok) | A mai könyvelt költségekből + EPR + tartási költségből számolt nullszaldó és cél ár; a nullszaldó naponta a napi tartási költség × 1,27-tel kúszik feljebb. Figyelmeztet, ha a tervezett / javasolt ár a cél alá csúszott, és megmondja, hány nap múlva éri el a nullszaldót. „Árazás az ÁrSugóban” gomb: az ÁrSugó az autó adataival előtöltve nyílik |
| Eladva (lezárt elszámolás) | Bruttó fedezet (nettó árbevétel − beszerzés), Nettó fedezet (− költségek − EPR), fedezet %, állásidő, napi fedezet |
| Terv kontra tény | A Forecastban az autóhoz rögzített terv (költségek, ár, dátum) a ténnyel szemben, eltérés zöld / piros színnel, automatikus „Miért tér el?” magyarázattal |
| Hasonló autók | Medián nettó fedezet és állásidő: azonos márka + modell; 3 alatt a márka, ha az is kevés, az összes eladott autó |
| Tartási költség | Állítható: lekötött pénz költsége (%/év, alap 8%) + fix napi költség (Ft/nap, alap 250); élőben számol, cégszintű alapértékként menthető. Becslés: a nettó fedezetet nem csökkenti |
| Ársáv, összetétel | Az ÁrSugó színes ársávja a valós számokkal; „Miből áll az ár” sávdiagram; PDF / nyomtatás |

## v3.3.3 – TAO és HIPA: teljes számítás, települési HIPA-szabályok a Kincstártól

| Terület | Funkció |
|---|---|
| Évzárás › TAO és HIPA (új oldal) | Üzleti évenként, **tény** vagy **tény + terv** (Forecast alap forgatókönyv) nézetben. **HIPA**: nettó árbevétel − ELÁBÉ (811, 814) − közvetített szolgáltatások (815) − anyagköltség (51) − alvállalkozói teljesítések − K+F (kézi) = vállalkozási szintű adóalap; 500 M Ft felett az ELÁBÉ sávos korlátja; megosztás székhely / telephelyek között; településenként a saját mérték és mentesség. **TAO**: adózás előtti eredmény (folyó évben a becsült HIPA-val csökkentve) + növelő − csökkentő tételek − elhatárolt veszteség (legfeljebb 50%, 5 évig) × 9%. Évek áttekintése, továbbvihető veszteség, 867 / 891 főkönyvi forgalom, bevallási határidő |
| Székhely és telephelyek | Irányítószám → település (Magyar Posta lista, 2023, MIT csomag); ha nincs megadva, a cég címéből a székhely 100%-kal |
| HIPA-szabályok | **Frissítés a Kincstártól** gomb: a hakka.allamkincstar.gov.hu országos havi adatállománya (minden önkormányzat mértéke és adóalap-mentessége, Htv. 39/C. § (2)); csak gombnyomásra. Tartalék: a HAKKA oldalról letöltött fájl kézi feltöltése (zip / xlsx / xls / csv / xml). Az utolsó frissítés naplója a fejlécekkel látszik, formátumváltozásnál ebből javítható. Letöltés előtt beépített szabály: Mór 2%, mentes 2,5 M Ft adóalap alatt (27/2018. rendelet) |
| Forecast és Cégérték | Ugyanezzel a számolóval: HIPA a HIPA-alapból a telephelyek szabályaival (nem az eredményből), TAO az elhatárolt veszteséggel. A Forecast forgatókönyv HIPA-mértéke és mentességi határa csak tartalék, ha nincs telephely |

## v3.3.2 – ÁrSugó: színes csúszka

| Terület | Funkció |
|---|---|
| ÁrSugó | Maga a húzható csúszka is színes: piros a beszerzési árig, sárga a nullszaldóig (éles határokkal), onnan halványtól egyre élénkebb zöld – minél nagyobb a profit, annál élénkebb. A jelölők (beszerzés, nullszaldó, cél, hirdetési) a csúszkán ülnek |

## v3.3.1 – ÁrSugó a kezdőlapon, rekord-felirat

| Terület | Funkció |
|---|---|
| Kezdőlap | ÁrSugó gomb a gyorsgombok között és link a „Tervezés és rendszer” csempén |
| Eladás-számláló | Új felirat: „Eddigi legrosszabb: N nap, most M nappal alatta vagy” (ha épp a mostani a leghosszabb: „ez most az új rekord”); a dátumok az egérrel rámutatva látszanak |

## v3.3.0 – Eladás-számláló a kezdőlapon, ÁrSugó hajtás-választó

| Terület | Funkció |
|---|---|
| Kezdőlap | Új csempe: **N nap az előző eladás óta**. A számláló a működés kezdetétől indul (Beállítások: működés kezdete, pl. PezCar 2025-07-01); egy napon több eladás egy eladási napnak számít. Szín a medián szünethez képest: alatta zöld (0 nap a legzöldebb), medián ±25% sárga, +25% felett egyre pirosabb (2,5× mediánnál a legerősebb). Kis betűvel a rekord szünet dátumokkal („most is tart”, ha épp a mostani a leghosszabb) |
| ÁrSugó | EPR hajtás-választó (belső égésű / HEV / PHEV / BEV) – díjátalánynál a díjtétel ettől függ |

## v3.2.1 – ÁrSugó finomítások

| Terület | Funkció |
|---|---|
| Ársáv | A csúszka sávja az ár összetételét mutatja: piros a beszerzési ár alatt, sárga amíg a költségek és az ÁFA nincs fedezve (nullszaldóig), zöld fölötte (profit); jelölők: beszerzés, nullszaldó, cél, hirdetési ár, jelmagyarázattal |
| Költségtételek | A lista alapból üres; az új tétel neve üres (szürke „Új tétel” helykitöltő), a kurzor rögtön a megnevezésben |
| EPR | EPR kategória legördülőben (M1 alapból, vagy „Nincs EPR – belföldi beszerzés”) és tömeg (kg); a díj = tömeg × a mai díjtétel (a cég díjátalány-beállítása szerint). Fix, ÁFA-t nem csökkentő költség: a bekerülést növeli, a különbözeti ÁFA alapját nem |

## v3.2.0 – ÁrSugó (árajánló)

Új menüpont a Tervezés alatt (és gomb a Gépkocsi készletnél): a beszerzési árat és a tervezett költségeket kell megadni, minden más számolt.

| Terület | Funkció |
|---|---|
| Árak | **Padló** (0 fedezet), **cél** (célfedezettel), **hirdetési** (cél + 5% alkuráhagyás, a legközelebbi …49 000-re vagy …99 000-re végződő árra kerekítve, lefelé vagy felfelé – pl. 4 083 450 → 4 099 000, 3 600 450 → 3 599 000; a padló alá sosem) |
| Célfedezet | Az elmúlt 12 hónapban eladott autók medián nettó fedezete (nettó árbevétel − teljes bekerülés), mint a KPI-Dashboardon; eladás nélkül a bekerülés 10%-a |
| ÁFA | Alapértelmezés mindkét oldalon a különbözeti: ÁFA = (eladási ár − beszerzési ár) × 27/127, negatív különbözetnél 0. Vételnél és eladásnál is választható a normál ÁFA (vételnél a bruttó árból levonható ÁFA, eladásnál ár × 27/127). Levont ÁFÁ-jú vétel után különbözeti eladás nem lehetséges – figyelmeztet és normál ÁFÁ-val számol |
| Felület | „Ársáv” elrendezés: nagy javasolt ár, színes sáv: piros a beszerzési ár alatt, sárga a nullszaldóig (költségek + ÁFA), zöld fölötte (profit), jelölővel a beszerzésre, nullszaldóra, célra és hirdetési árra, próbaár csúszka élő fedezettel és ÁFÁ-val |

## v3.1.0 – Papír alapú számlák: iktatás és automatikus ellenőrzések

| Terület | Funkció |
|---|---|
| Folyamat | Papír számla → Google Drive app *Szkennelés* (vagy Microsoft Lens) → Bejövő számlák mappa / kézi feltöltés → „Beolvasás és könyvelés”. A szöveget a Google Drive ingyenes OCR-je adja, a kiolvasás szabályalapú (AI nélkül) |
| Iktatás – a papírra nem kell írni | Minden szkennelt / fotózott bizonylat automatikusan kap egy cégenként és évenként folyamatos iktatószámot (`P-2026-0001`). A papírt havonta a beszkennelés sorrendjében kell lefűzni; a bizonylat helye (pl. „2026-11 / 7. tétel”) a beszkennelés idejéből adódik (Drive: a fájl létrehozása, feltöltésnél a feltöltés ideje). Az iktatószám és a hely rá van nyomtatva a digitális példányra (pecsételt PDF; `?original=1` az eredeti). Megjelenik a lekönyvelt számla megjegyzésében is. Szövegréteges szkennelt PDF-nél kézzel is iktatható |
| Papír archívum | Új fül a Beérkező bizonylatoknál: a papír bizonylatok a lefűző sorrendjében (hónap · sorszám), a papír visszakereséséhez |
| Ellenőrzések | Adószám ellenőrző számjegye (CDV), ÁFA-kód és megyekód · ÁFA = nettó × kulcs tételenként (kerekítési tűréssel) · jövőbeli / egy évnél régebbi dátum, teljesítés jóval a kelt után · lezárt hónap · már bevallott ÁFA-időszakba eső késve érkezett számla. Ami nem stimmel, nem könyvelődik magától, a jóváhagyó képernyőn látszik az ok |
| Bank | Ha a bruttó összeg pontosan egy, még párosításra váró kivonatsorral egyezik, a javaslat jelzi („a bruttó egyezik egy banki tétellel”) |

## v3.0.1 – Jelenléti naptár, CEO - Ügyvezető szerepkör, készlettervezés törlés

| Terület | Funkció |
|---|---|
| Bérszámfejtés – jelenléti naptár | Soronként naptár a havi bértáblában: munkában / szabadság / betegszabadság (70%) / táppénz / fizetés nélküli / nem beosztott. Távollét-levonás, pihenő- és munkaszüneti napi munka 100% pótléka, EFO-napok a naptárból, 15 napos betegszabadság-figyelmeztetés. Munkaszüneti napok és 2025–2026 munkanap-áthelyezések (dec. 24. munkaszüneti nap 2026-tól) |
| Szerepkörök | A „csak olvasás” szerepkör neve „CEO - Ügyvezető” (jogosultság változatlan) |
| Készlettervezés | Az autónkénti „törlés” az eladási árat és a dátumot is kiüríti (a még nem mentett beírást is) |

## v2.2.4 – KPI-Dashboard, Évzárás, Cégérték · v2.2.1 – Kétlépcsős azonosítás, Admin hozzáférések, forecast törlés

| Terület | Funkció |
|---|---|
| Kétlépcsős azonosítás | Kötelező mindenkinek: jelszó + hitelesítő alkalmazás (TOTP, 6 jegy / 30 mp). Első belépéskor QR-kódos beállítás és 10 egyszer használható tartalékkód; 5 hibás kód → 15 perc zárolás; jelszócsere és 2FA visszaállítás a többi eszközt kilépteti |
| Admin (/admin) | Felhasználó × cég hozzáférési mátrix (szerepkör azonnal szerkeszthető, az utolsó tulajdonos védett), 2FA állapot, tartalékkódok, utolsó belépés, 2FA visszaállítása, kiléptetés |
| KPI-Dashboard | Kimutatások › KPI-Dashboard (csak Bt / Kft / Zrt): állásidő és 30/60/90 napos bontás, készletforgás, lekötött tőke, árrés (Ft, %), nettó haszon rezsivel, felújítási arány, típusonként és beszerzési forrás szerint, szabad pénz, tőkearányos megtérülés, készpénzciklus, tagi kölcsön, havi vett/eladott trend, fedezeti pont, terv vs. tény, különbözeti ÁFA negyedévente, várható EPR-díj |
| Évzárás | Új menüpont a Főkönyv alatt: főkönyvi kivonat és éves beszámoló évenként, külön a folyó év és a lezárt évek (lezárt hónapok, mentett beszámoló, eredmény, mérlegfőösszeg) |
| Menü | Éves beszámoló és Főkönyvi kivonat az Évzárásba került; a kezdőlapon az ÁFA analitika és a különbözeti ÁFA kartonok egy „ÁFA” pontban, a két oldal között fülekkel |
| Cégérték | Új csempe az Áttekintésen (csak Bt / Kft / Zrt): korrigált nettó eszközérték; kattintásra a részletező oldal mindhárom számítással – korrigált nettó eszközérték, eredményszorzós (szorzó beállítható, alap 3), előretekintő (Forecast, három forgatókönyv, diszkontráta beállítható) |
| Forecast | „Összes törlése” a tervezett beszerzéseknél és a költségeknél; „Visszaállítás” a Forgatókönyveknél (alapértékek) és a Kimutatáson (a teljes forecast kiürítése) |

## v2.1.0 – EPR (kiterjesztett gyártói felelősség) – gépjármű · DRAFT

A különbözeti ÁFA karton mintájára: **EPR karton gépkocsinként** és **negyedéves EPR összesítő** (OKIR KG:KGYF-NÉ, határidő a negyedévet követő hónap 20-a).

| Terület | Funkció |
|---|---|
| Gépkocsi adatok | EPR kategória (M1 / N1 / háromkerekű), hajtás (belső égésű / HEV / PHEV / BEV), tömeg (kg), származás (automatikus a beszerzési számla partnerének országából, vagy kézzel) |
| Kötelezettség | Külföldről behozott autó első belföldi eladása; belföldi beszerzés és külföldi vevő → nem kötelezett; hiányzó adat → „nem eldönthető” lista |
| Díj | Ft/kg × tömeg, díjtábla a forgalomba hozatal napja szerint (2025. 10. 01-től: 36 Ft/kg, ill. díjátalány pl. M1 belső égésű 44,89 Ft/kg) |
| KF kód | 15 + anyagáram + csoport (1980 előtt/után, átalány szerint) + 1 (kollektív) + származáskód (Beállítások) |
| Beállítások | Díjátalány választása (egész évre), KF 8. karakter |
| Ellenőrzések | Hiányzó tömeg/évjárat/hajtás, ellenőrizetlen díjtábla, céges vevőnél a számla EPR-szövege |

⚠ Élesítés előtt egyeztetendő: a KF csoport- és származáskód (80/2023. 1. melléklet 2.4.5, 2.6) és a 2025. október előtti díjtábla.

## Ütemterv

1. ~~Könyvelési mag~~ ✅
2. ÁFA bevallás (2665A sorok), NAV Online Számla lekérdezés / egyeztetés
3. Bankkivonat import, pénztár bizonylatok
4. Tárgyi eszköz nyilvántartás + értékcsökkenés
5. Mérleg és eredménykimutatás (2000. évi C. tv.), fordulónapi devizás átértékelés, évzárás / évnyitás
6. Exportok (Excel/PDF), elemzések, dashboard

## Helyi fejlesztés

```bash
npm install
cp .env.example .env.local      # DATABASE_URL + SESSION_SECRET
npm run db:migrate
npm run dev                     # http://localhost:3000 → első indításkor /setup
```

Tesztek: `npm test` (kontírozási logika, adatbázis nélkül), `npm run test:integration` (teljes könyvelési folyamat egy friss tesztcégen:
különbözeti ÁFA, helyesbítő számla, beszámítás, párosítás, deviza, sztornó, időszakzár, eszköz, bér, elhatárolás, ÁFA-zárás, kiegészítő import,
főkönyv / mérleg / ÁFA egyeztetés — `TEST_DATABASE_URL` kell, előtte `DATABASE_URL=… npm run db:migrate`; **soha ne az éles adatbázisra**;
GitHub Actions minden PR-en lefuttatja egy üres Postgresen) és `npm run db:seed-demo` (teljes gépkocsi-életút egy valódi adatbázison, egyensúly- és ÁFA-ellenőrzéssel — **csak teszt adatbázison futtasd**, demó céget hoz létre).

Séma módosítás: `src/db/schema.ts` szerkesztése → `npm run db:generate` → a generált SQL a `drizzle/` mappába kerül, deploykor automatikusan lefut.

## Telepítés (Neon + Render)

1. **Neon:** új projekt (régió: Frankfurt) → *Connection details* → **Pooled** connection string.
2. **Render:** *New → Blueprint* → ezt a repót választva a `render.yaml` alapján létrejön a `mm-erp` web service.
3. Render-en a `DATABASE_URL` env változóba másold be a Neon pooled URL-t (`?sslmode=require`). A `SESSION_SECRET`-et a Render generálja.
4. Deploy: indításkor lefutnak a migrációk, majd `/setup` oldalon létrehozod az admin felhasználót, a főoldalon pedig a cégeket.

Minden `main`-re pusholt commit automatikusan deployol.

## Könyvelési elvek

- Könyvelt tétel nem módosítható – javítás piros stornóval (ugyanazon oldal, negatív összeg), így a forgalom nem duzzad.
- Minden tétel egyensúlyát az adatbázisba írás előtt ellenőrizzük; lezárt hónapba nem lehet könyvelni.
- **Árfolyam-politika (MNB):** a devizás számla ÁFA alapja és a követelés / kötelezettség könyv szerinti értéke is az MNB hivatalos árfolyamán, az Áfa tv. 80. § szerinti napon (teljesítés; időszakos elszámolásnál a számla kelte; KBB-nél a számla kelte, legkésőbb a teljesítést követő hó 15-e) – Szt. 60. § (5a). Az árfolyamot az app automatikusan letölti az MNB-től (kézzel felülírható).
- **Kiegyenlítés (Szt. 60. §):** forintszámláról a ténylegesen terhelt / jóváírt forint; devizaszámlára befolyó deviza MNB árfolyamon; devizaszámláról kifizetett deviza könyv szerinti átlagárfolyamon. Az eltérés realizált árfolyam-különbözet (976 / 876).
- A gépkocsi könyv szerinti értéke a 261-es számla gépkocsihoz rendelt tételeiből adódik. A különbözeti ÁFA alapja csak a beszerzési ár (a javítás ÁFÁ-ja levonható, nem része az alapnak) – a gépkocsin kézzel felülírható.

> A könyvelési szabályokat egyeztesd a könyvelőddel – különösen az EU-s gépkocsi beszerzéseknél (különbözeti vs. KBB), és a devizás számlák ÁFA-árfolyamánál.

### v2.0 – Vendégház elemzés (adószámos magánszemély)

A vendégház nézet P&L- és cash flow-fókuszú; a könyvelési (főkönyvi) nézetek nem szerepelnek a menüben.

- **Áttekintés** – heti / havi / éves mutatók az előző és a tavalyi azonos időszakkal (folyamatban lévő időszaknál azonos hosszon): bevétel, eredmény, árrés, cash flow, kihasználtság, ADR, RevPAR, átlagos tartózkodás, közvetlen arány, Airbnb jutalék %, ROAS, költség/éj; fedezeti pont (utolsó 12 hó), megtérülés, ÁFA-keret, szezonalitási hőtérkép.
- **Eredmény (P&L)** – teljesítés szerint (szállásdíj a vendégéjszakákra, havi tételek a hónap napjaira, rezsi a számlázási időszakra), heti / havi / éves.
- **Cash flow** – tényleges pénzmozgás (bank + magánpénz), számított adók esedékesség szerint, halmozott görbe.
- **Megtérülés** – vételár + illeték diszkontált és nominális megtérülése (havi / negyedéves / éves / LTD), állítható diszkontráta, előrejelzés az utolsó 12 hónap alapján.
- **Foglalások** – naptár, foglaláslista előidővel, közvetlen foglalás rögzítése.
- **Költség rögzítése** – gyors űrlap, havi ismétléssel, sztornóval.

Számítás: `src/lib/gh-calc.ts` (tiszta függvények, tesztek: `tests/gh-calc.test.ts`), adatbetöltés: `src/lib/guesthouse.ts`.
