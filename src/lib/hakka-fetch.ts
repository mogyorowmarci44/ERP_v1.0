/**
 * v3.3.3 – „Frissítés a Kincstártól”: a hakka.allamkincstar.gov.hu országos havi adatállományának letöltése.
 * Az oldal ASP.NET WebForms: a letöltés egy postback (ctl00$tartalom$libLetoltes), ami a Letoltes.aspx oldalra visz;
 * ott a havi állományok linkként vagy újabb postbackként szerepelnek – a legelsőt (legfrissebbet) töltjük le.
 * Csak gombnyomásra fut (nincs időzítő). Ha a Kincstár oldala megváltozik, a hibaüzenet és a lépések naplója
 * megmutatja, hol akadt el; addig a fájl kézzel is feltölthető.
 */
import "server-only";

const BASE = "https://hakka.allamkincstar.gov.hu/";
const UA = "Mozilla/5.0 (compatible; mogyorosi.erp HIPA-frissites)";
const FILE_RE = /\.(zip|xlsx?|csv|xml|txt|ods)(\?|$)/i;

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
function keepCookies(res: Response, jar: Jar) {
  const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const c of all) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}

async function req(url: string, jar: Jar, init: RequestInit = {}, log: string[]): Promise<Response> {
  let u = url;
  let opts: RequestInit = init;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(u, { ...opts, redirect: "manual", headers: { "User-Agent": UA, Cookie: cookieHeader(jar), ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    keepCookies(res, jar);
    const loc = res.headers.get("location");
    log.push(`${opts.method ?? "GET"} ${u.replace(BASE, "/")} → ${res.status}${loc ? ` → ${loc}` : ""}`);
    if (res.status >= 300 && res.status < 400 && loc) { u = new URL(loc, u).toString(); opts = { method: "GET" }; continue; }
    return res;
  }
  throw new Error("Túl sok átirányítás a Kincstár oldalán.");
}

const hidden = (html: string) => Object.fromEntries([...html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)].map((m) => {
  const name = m[0].match(/name="([^"]+)"/)?.[1]; const value = m[0].match(/value="([^"]*)"/)?.[1] ?? "";
  return [name ?? "", value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")];
}).filter(([n]) => n));
const formAction = (html: string, pageUrl: string) => new URL((html.match(/<form[^>]+action="([^"]*)"/i)?.[1] ?? "").replace(/&amp;/g, "&") || pageUrl, pageUrl).toString();

async function postback(pageUrl: string, html: string, target: string, jar: Jar, log: string[]) {
  const body = new URLSearchParams({ ...hidden(html), __EVENTTARGET: target, __EVENTARGUMENT: "" });
  return req(formAction(html, pageUrl), jar, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: pageUrl }, body: body.toString() }, log);
}

const isFile = (res: Response) => {
  const ct = res.headers.get("content-type") ?? "";
  return !!res.headers.get("content-disposition") || (!/text\/html/i.test(ct) && ct !== "");
};
const fileName = (res: Response, fallback: string) => {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : fallback;
};

export type HakkaDownload = { files: { name: string; data: Uint8Array }[]; label: string; log: string[] };

export async function downloadHakka(): Promise<HakkaDownload> {
  const jar: Jar = new Map();
  const log: string[] = [];
  const home = await req(BASE, jar, {}, log);
  const homeHtml = await home.text();
  const target = homeHtml.match(/__doPostBack\('([^']*libLetoltes[^']*)'/)?.[1]?.replace(/&#39;/g, "'")
    ?? homeHtml.match(/WebForm_PostBackOptions\(&quot;([^&]*libLetoltes[^&]*)&quot;/)?.[1]
    ?? "ctl00$tartalom$libLetoltes";
  let res = await postback(BASE, homeHtml, target, jar, log);
  let pageUrl = res.url || new URL("Letoltes.aspx", BASE).toString();
  if (!isFile(res)) {
    const html = await res.text();
    if (!/Letoltes/i.test(pageUrl)) pageUrl = new URL("Letoltes.aspx", BASE).toString();
    // 1) közvetlen fájllinkek
    const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ href: m[1].replace(/&amp;/g, "&"), text: m[2].replace(/<[^>]+>/g, "").trim() }));
    const fileLink = links.find((l) => FILE_RE.test(l.href));
    // 2) postback linkek a havi állományokra (a legelső a legfrissebb)
    const pb = links.map((l) => ({ ...l, target: l.href.match(/__doPostBack\('([^']+)'/)?.[1] })).filter((l) => l.target && !/libLetoltes|indexCtrl/.test(l.target!));
    log.push(`Letöltési oldal: ${links.length} link, ${links.filter((l) => FILE_RE.test(l.href)).length} fájl-link, ${pb.length} postback (${pb.slice(0, 4).map((p) => p.text).join(" · ")})`);
    if (fileLink) res = await req(new URL(fileLink.href, pageUrl).toString(), jar, {}, log);
    else if (pb.length) res = await postback(pageUrl, html, pb[0].target!, jar, log);
    else throw Object.assign(new Error("A Kincstár letöltési oldalán nem található letölthető állomány."), { log });
    if (!isFile(res)) throw Object.assign(new Error("A Kincstár nem fájlt küldött vissza (valószínűleg megváltozott az oldal felépítése)."), { log });
    const name = fileName(res, fileLink ? fileLink.href.split("/").pop()! : `${pb[0].text || "hakka"}.zip`);
    const data = new Uint8Array(await res.arrayBuffer());
    log.push(`Letöltve: ${name} (${Math.round(data.length / 1024)} kB)`);
    return { files: [{ name, data }], label: fileLink?.text || pb[0]?.text || name, log };
  }
  const name = fileName(res, "hakka.zip");
  const data = new Uint8Array(await res.arrayBuffer());
  log.push(`Letöltve: ${name} (${Math.round(data.length / 1024)} kB)`);
  return { files: [{ name, data }], label: name, log };
}
