import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getVendor, TERMS_VERSION, vendorMissing, type Vendor } from "@/lib/vendor";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * v6.1.0 – Jogi dokumentumok (nyilvánosak, belépés nélkül is olvashatók): ÁSZF, adatkezelési tájékoztató, adatfeldolgozói szerződés.
 * A szolgáltató adatai az üzemeltetői oldalon állíthatók; amíg jogász át nem nézte, „tervezet” sáv jelzi.
 */
const DOCS: Record<string, { title: string; body: (v: Vendor) => ReactNode }> = {
  aszf: { title: "Általános Szerződési Feltételek", body: Aszf },
  adatkezeles: { title: "Adatkezelési tájékoztató", body: Adatkezeles },
  adatfeldolgozas: { title: "Adatfeldolgozói szerződés", body: Adatfeldolgozas },
};

const SUBPROCESSORS = [
  ["Render Services, Inc. (USA)", "alkalmazásszerver – az adatok az EU-ban, Frankfurtban futó szerveren kerülnek feldolgozásra", "EU általános szerződési feltételek (SCC) / EU–USA adatvédelmi keretrendszer"],
  ["Neon (Databricks, Inc., USA)", "adatbázis-tárhely – AWS eu-central-1 (Frankfurt) régió", "EU általános szerződési feltételek (SCC) / EU–USA adatvédelmi keretrendszer"],
  ["Sendinblue SAS – Brevo (Franciaország)", "e-mail kézbesítés (meghívó, jelszó-visszaállítás, napi összefoglaló), ha ez a beállított küldő", "EU-n belüli adattovábbítás"],
  ["Google LLC (USA)", "e-mail kézbesítés Gmail-továbbítón át, ha ez a beállított küldő", "EU általános szerződési feltételek (SCC) / EU–USA adatvédelmi keretrendszer"],
  ["Enable Banking Oy (Finnország)", "banki tranzakciók letöltése (PSD2) – csak ha az Ügyfél bekapcsolja", "EU-n belüli adattovábbítás"],
];

function V({ v, k, label }: { v: Vendor; k: keyof Vendor; label: string }) {
  const val = v[k];
  return val ? <>{String(val)}</> : <mark title="Az üzemeltetői oldalon kitöltendő">[{label}]</mark>;
}

export default async function LegalDoc({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc];
  if (!d) notFound();
  const v = await getVendor();
  const missing = vendorMissing(v);
  return (
    <div className="main legal-doc" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>{d.title}</h1>
        </div>
        <div className="row" style={{ gap: 12, fontSize: 14 }}>
          {Object.entries(DOCS).filter(([k]) => k !== doc).map(([k, x]) => <Link key={k} href={`/jogi/${k}`}>{x.title}</Link>)}
          <Link href="/">Belépés</Link>
        </div>
      </div>
      {(!v.legalReviewed || missing.length > 0) && (
        <div className="flash error" role="status">
          Tervezet – jogi ellenőrzés előtt. {missing.length > 0 && <>Hiányzó szolgáltatói adatok: {missing.join(", ")}.</>}
        </div>
      )}
      <p className="muted">Hatályos: {TERMS_VERSION} · Szolgáltató: <V v={v} k="name" label="szolgáltató neve" /></p>
      {d.body(v)}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}

function Szolgaltato({ v }: { v: Vendor }) {
  return (
    <ul>
      <li>Név: <V v={v} k="name" label="szolgáltató neve" /></li>
      <li>Székhely: <V v={v} k="seat" label="székhely" /></li>
      <li>Cégjegyzékszám: <V v={v} k="regNumber" label="cégjegyzékszám" /></li>
      <li>Adószám: <V v={v} k="taxNumber" label="adószám" /></li>
      <li>E-mail: <V v={v} k="email" label="e-mail" />{v.phone && <> · Telefon: {v.phone}</>}{v.web && <> · Web: {v.web}</>}</li>
    </ul>
  );
}

function Aszf(v: Vendor) {
  return (
    <>
      <h2>1. A szolgáltató</h2>
      <Szolgaltato v={v} />
      <h2>2. A szolgáltatás</h2>
      <p>
        A mogyorosi.erp böngészőből használható, felhőben futó könyvelési és vállalatirányítási szoftver (a továbbiakban: Szolgáltatás):
        számlák és bizonylatok nyilvántartása, kettős könyvvitel, ÁFA- és adóanalitika, bevallás-előkészítés, bérszámfejtés, tárgyi eszközök,
        beszámoló, kimutatások és kapcsolódó modulok. Az Ügyfél (az ügyfélfiók jogosultja) a Szolgáltatást a saját vagy ügyfelei könyveléséhez használja.
      </p>
      <h2>3. Ügyfélfiók, felhasználók, hozzáférés</h2>
      <ul>
        <li>Az ügyfélfiókot a Szolgáltató hozza létre; az Ügyfél adminja hívja meg a további felhasználókat, és ő dönt a cégekhez való hozzáférésükről.</li>
        <li>A felhasználó köteles a belépési adatait (jelszó, kétlépcsős azonosítás) titokban tartani. A felhasználók által végzett műveletekért az Ügyfél felel.</li>
        <li>A Szolgáltató az Ügyfél adataihoz csak hibaelhárítás céljából, az Ügyfél kérésére vagy jogszabályi kötelezettség alapján, csak olvasásra,
          időkorlátosan és naplózottan fér hozzá; ez az Ügyfél tevékenységnaplójában is megjelenik.</li>
      </ul>
      <h2>4. Az Ügyfél felelőssége</h2>
      <ul>
        <li>A Szolgáltatás eszköz: a könyvelés, a bevallások és a beszámolók tartalmáért, határidőben történő benyújtásáért, valamint a jogszabályi
          (adó-, számviteli) megfelelésért az Ügyfél, illetve az általa megbízott könyvelő felel. A program által számolt értékeket benyújtás előtt ellenőrizni kell.</li>
        <li>A számviteli bizonylatok megőrzési kötelezettsége (Szt. 169. §, legalább 8 év) az Ügyfelet terheli. Ehhez a Szolgáltatás teljes mentést biztosít;
          a mentések megőrzéséről az Ügyfél gondoskodik.</li>
      </ul>
      <h2>5. Rendelkezésre állás, mentés</h2>
      <p>
        A Szolgáltató a Szolgáltatást a tőle elvárható gondossággal üzemelteti, de folyamatos, hibamentes működést nem vállal. Karbantartás miatt a
        Szolgáltatás rövid időre elérhetetlen lehet. Az adatbázisról a tárhelyszolgáltató rövid távú, időpontra visszaállítható mentést készít; ezen felül
        az Ügyfél bármikor letöltheti cégei teljes mentését, és abból visszaállíthatja azokat.
      </p>
      <h2>6. Díjak</h2>
      <p>A Szolgáltatás díját és a fizetés módját az egyedi megrendelés / ajánlat tartalmazza. Díjfizetés hiányában a Szolgáltató – előzetes értesítés után – a hozzáférést csak olvashatóra korlátozhatja; az adatokat ilyenkor sem törli.</p>
      <h2>7. Felelősségkorlátozás</h2>
      <p>
        A Szolgáltató felelőssége – a szándékosan, súlyos gondatlansággal okozott, valamint az életet, testi épséget, egészséget megkárosító szerződésszegést
        kivéve – a kár bekövetkezését megelőző 12 hónapban az Ügyfél által megfizetett díj összegéig terjed. A Szolgáltató nem felel az Ügyfél által rögzített
        adatok helyességéért, a hibás adatból számolt értékekért, valamint harmadik fél (pl. bank, NAV, tárhelyszolgáltató) szolgáltatásának kieséséért.
      </p>
      <h2>8. Megszűnés, adatok</h2>
      <ul>
        <li>A szerződést bármelyik fél 30 napos felmondási idővel, írásban felmondhatja.</li>
        <li>Megszűnéskor az Ügyfél a felmondási idő alatt letöltheti cégei teljes mentését. A megszűnést követő 30 nap elteltével a Szolgáltató az Ügyfél
          adatait törli, kivéve, ha jogszabály további megőrzést ír elő.</li>
        <li>Cég archiválása és végleges törlése a programban az Ügyfél saját döntése; a véglegesen törölt adat csak az Ügyfél mentéséből állítható vissza.</li>
      </ul>
      <h2>9. Adatvédelem</h2>
      <p>
        A felhasználói fiókok adatainak kezeléséről az <Link href="/jogi/adatkezeles">Adatkezelési tájékoztató</Link> rendelkezik. Az Ügyfél által a
        Szolgáltatásban rögzített személyes adatok (pl. munkavállalók, partnerek, tagok adatai) tekintetében az Ügyfél adatkezelő, a Szolgáltató adatfeldolgozó;
        erre az <Link href="/jogi/adatfeldolgozas">Adatfeldolgozói szerződés</Link> az irányadó, amely ezen ÁSZF elválaszthatatlan része.
      </p>
      <h2>10. Egyéb</h2>
      <p>A Szolgáltató az ÁSZF-et módosíthatja; a módosítást belépéskor jelzi, és a további használat feltétele az elfogadása. A szerződésre a magyar jog irányadó.</p>
    </>
  );
}

function Adatkezeles(v: Vendor) {
  return (
    <>
      <p>Ez a tájékoztató a mogyorosi.erp <strong>felhasználóinak</strong> személyes adatairól szól, amelyeket a Szolgáltató adatkezelőként kezel.
        A felhasználók által a programban rögzített adatokra (munkavállalók, partnerek, tagok stb.) az <Link href="/jogi/adatfeldolgozas">Adatfeldolgozói szerződés</Link> vonatkozik.</p>
      <h2>1. Adatkezelő</h2>
      <Szolgaltato v={v} />
      <h2>2. Kezelt adatok, célok, jogalapok, időtartam</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Adat</th><th>Cél</th><th>Jogalap (GDPR 6. cikk)</th><th>Időtartam</th></tr></thead>
          <tbody>
            <tr><td>név, e-mail cím, jelszó (csak titkosított lenyomat), kétlépcsős azonosítás kulcsa</td><td>fiók létrehozása, belépés, azonosítás</td><td>szerződés teljesítése (b)</td><td>a fiók megszűnéséig + 30 nap</td></tr>
            <tr><td>belépések időpontja, IP-cím, sikertelen próbálkozások</td><td>visszaélések megelőzése, fiókvédelem</td><td>jogos érdek (f)</td><td>tevékenységnapló: 5 év; zárolási számláló: legfeljebb 1 óra</td></tr>
            <tr><td>a programban végzett műveletek naplója (ki, mikor, mit)</td><td>elszámoltathatóság, az Ügyfél könyvelésének nyomon követhetősége</td><td>jogos érdek (f)</td><td>5 év (polgári jogi elévülés)</td></tr>
            <tr><td>az ÁSZF és e tájékoztató elfogadásának ideje és változata</td><td>a szerződés létrejöttének igazolása</td><td>szerződés teljesítése (b)</td><td>a fiók megszűnése után 5 év</td></tr>
            <tr><td>munkamenet-süti (belépve maradás)</td><td>a belépett állapot fenntartása</td><td>a szolgáltatás nyújtásához feltétlenül szükséges</td><td>legfeljebb 12 óra / kilépésig</td></tr>
          </tbody>
        </table>
      </div>
      <p>A program csak a működéséhez feltétlenül szükséges sütit használ; követő, reklám- vagy elemző sütit nem.</p>
      <h2>3. Adatfeldolgozók</h2>
      <Subprocessors />
      <h2>4. Adatbiztonság</h2>
      <p>Titkosított kapcsolat (HTTPS), jelszavak csak lenyomatként (bcrypt), kötelezővé tehető kétlépcsős azonosítás, belépési próbálkozások korlátozása,
        ügyfélfiókonként elkülönített adatok, az érzékeny személyes adatok (adóazonosító jel, anyja neve, születési hely, lakcím) mezőszintű titkosítása,
        az üzemeltetői hozzáférés naplózása.</p>
      <h2>5. Az érintett jogai</h2>
      <p>Kérelmezhető a hozzáférés, helyesbítés, törlés, a kezelés korlátozása, adathordozhatóság, valamint tiltakozás a jogos érdeken alapuló adatkezelés ellen
        – a fenti e-mail címen, vagy önkiszolgáló módon a programban (Fiókom és adataim: saját adatok letöltése JSON-ban, a fiók törlése; az ügyfélfiók adminjának az ügyfélfiók
        megszüntetése). Fióktörléskor a név, az e-mail cím, a jelszó és a kétlépcsős azonosítás törlődik; a számviteli megőrzési kötelezettség alá eső könyvelési tételeknél a
        felhasználó helyén „Törölt felhasználó” marad (álnevesítés). A Szolgáltató a kérelmet legfeljebb egy hónapon belül teljesíti. Panasz a Nemzeti Adatvédelmi és Információszabadság Hatóságnál
        (NAIH, 1055 Budapest, Falk Miksa utca 9–11., ugyfelszolgalat@naih.hu) tehető, illetve bírósághoz lehet fordulni.</p>
    </>
  );
}

function Subprocessors() {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Adatfeldolgozó</th><th>Feladat, helyszín</th><th>Garancia</th></tr></thead>
        <tbody>{SUBPROCESSORS.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Adatfeldolgozas(v: Vendor) {
  return (
    <>
      <p>
        E szerződés (GDPR 28. cikk) az ÁSZF része, és azokra a személyes adatokra vonatkozik, amelyeket az <strong>Ügyfél (adatkezelő)</strong> a
        mogyorosi.erp-ben rögzít, és amelyeket a <strong>Szolgáltató (adatfeldolgozó)</strong> a Szolgáltatás nyújtása során tárol és feldolgoz.
        Az ÁSZF elfogadásával az Ügyfél e szerződést is elfogadja.
      </p>
      <h2>1. Adatfeldolgozó</h2>
      <Szolgaltato v={v} />
      <h2>2. Az adatfeldolgozás tárgya</h2>
      <ul>
        <li><strong>Érintettek:</strong> az Ügyfél munkavállalói, tagjai, vezető tisztségviselői, magánszemély partnerei (vevők, szállítók), szálláshely-vendégei, kapcsolattartói.</li>
        <li><strong>Adatok:</strong> név, cím, adóazonosító jel, adószám, születési hely és idő, anyja neve, bankszámlaszám, bér- és járulékadatok,
          jogviszony adatai, számla- és fizetési adatok, a bizonylatokon szereplő egyéb adatok.</li>
        <li><strong>Cél és időtartam:</strong> kizárólag a Szolgáltatás nyújtása (tárolás, megjelenítés, számítás, bevallás-előkészítés, mentés) a szerződés fennállása alatt.</li>
      </ul>
      <h2>3. A Szolgáltató kötelezettségei</h2>
      <ul>
        <li>Az adatokat kizárólag az Ügyfél dokumentált utasítása (a program használata, illetve írásbeli kérés) szerint kezeli, saját célra nem használja.</li>
        <li>A hozzáféréssel rendelkező személyeit titoktartásra kötelezi.</li>
        <li>Megfelelő technikai és szervezési intézkedéseket alkalmaz (ld. az Adatkezelési tájékoztató „Adatbiztonság” pontját), beleértve az érzékeny mezők titkosítását.</li>
        <li>További adatfeldolgozót csak az alábbi listában, illetve az Ügyfél előzetes értesítése után vesz igénybe; az Ügyfél a változás ellen tiltakozhat.</li>
        <li>Segíti az Ügyfelet az érintetti kérelmek teljesítésében és az adatvédelmi incidensek kezelésében; incidensről indokolatlan késedelem nélkül, legkésőbb 48 órán belül értesíti.</li>
        <li>A szerződés megszűnésekor – az Ügyfél választása szerint – az adatokat a teljes mentés formájában átadja, majd 30 napon belül törli, kivéve, ha jogszabály megőrzést ír elő.</li>
        <li>Az Ügyfél rendelkezésére bocsát minden információt, amely e kötelezettségek teljesítésének igazolásához szükséges.</li>
      </ul>
      <h2>4. Igénybe vett további adatfeldolgozók</h2>
      <Subprocessors />
      <h2>5. Az Ügyfél kötelezettségei</h2>
      <p>Az Ügyfél felel azért, hogy a személyes adatok rögzítésére jogalappal rendelkezik, és az érintetteket tájékoztatta. Az Ügyfél adminja dönt arról, mely felhasználók férnek hozzá az egyes cégek adataihoz.</p>
    </>
  );
}
