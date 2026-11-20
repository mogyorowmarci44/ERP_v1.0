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
