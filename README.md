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

Tesztek: `npm test` (kontírozási logika) és `npm run db:seed-demo` (teljes gépkocsi-életút egy valódi adatbázison, egyensúly- és ÁFA-ellenőrzéssel — **csak teszt adatbázison futtasd**, demó céget hoz létre).

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
