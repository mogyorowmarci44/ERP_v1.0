/**
 * MM ERP – Beérkező bizonylatok (Gmail + Drive) kapcsolat.
 *
 * NINCS időzítő: ez a szkript csak akkor fut, amikor az ERP-ben megnyomod a „Beolvasás és könyvelés” gombot.
 * Csak olvas: leveleket, csatolmányokat és a megadott Drive-mappák fájljait adja át az ERP-nek. Semmit nem töröl, nem küld.
 *
 * Telepítés (egyszer, cégenként abban a Google-fiókban, ahová a számlák jönnek):
 *  1. script.google.com → Új projekt → ide másold be ezt a fájlt.
 *  2. Az alábbi KULCS helyére írd be az ERP-ben (Beérkező bizonylatok → Beállítások) generált kulcsot.
 *  3. Telepítés → Új telepítés → Típus: Webes alkalmazás → Végrehajtás mint: Én → Hozzáférés: Bárki → Telepítés.
 *     (Első futáskor engedélyezni kell a Gmail és Drive olvasását.)
 *  Szkennelt / fotózott számlákhoz: a szerkesztő bal oldalán Szolgáltatások (+) → Drive API → Hozzáadás.
 *  Ezzel a Google ingyenes szövegfelismerése (OCR) olvassa ki a képeket – AI és díj nélkül.
 *  4. A kapott „…/exec” webcímet másold be az ERP beállításaiba.
 */
const KULCS = 'IDE_JON_AZ_ERP_KULCS';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!req.secret || req.secret !== KULCS) return out_({ ok: false, error: 'Hibás kulcs' });
    if (req.action === 'ping') return out_({ ok: true, account: Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() });
    if (req.action === 'list') return out_({ ok: true, items: list_(req) });
    if (req.action === 'get') return out_(Object.assign({ ok: true }, get_(req.ref)));
    if (req.action === 'ocr') return out_({ ok: true, text: ocr_(req) });
    return out_({ ok: false, error: 'Ismeretlen művelet: ' + req.action });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const OK_TYPE = /pdf|image\/|xml|csv|spreadsheet|ms-excel/i;
const OK_NAME = /\.(pdf|jpe?g|png|webp|heic|heif|xml|csv|xlsx)$/i;

function list_(req) {
  const known = {};
  (req.known || []).forEach(function (k) { known[k] = true; });
  const since = req.since ? new Date(req.since + 'T00:00:00') : null;
  const items = [];
  const me = Session.getEffectiveUser().getEmail();

  let q = req.query || 'has:attachment';
  if (req.since) q += ' after:' + req.since.replace(/-/g, '/');
  const threads = GmailApp.search(q, 0, 200);
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (since && m.getDate() < since) return;
      m.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
        const ct = a.getContentType() || '', name = a.getName() || ('csatolmany-' + i);
        if (!OK_TYPE.test(ct) && !OK_NAME.test(name)) return;
        const ref = 'gmail:' + m.getId() + ':' + i;
        if (known[ref]) return;
        items.push({ ref: ref, source: 'gmail', kind: 'invoice', filename: name, mime: ct, size: a.getSize(),
          url: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + m.getId(),
          from: m.getFrom(), subject: m.getSubject(), date: m.getDate().toISOString() });
      });
    });
  });

  [[req.invoiceFolderId, 'invoice'], [req.statementFolderId, 'statement']].forEach(function (pair) {
    if (!pair[0]) return;
    const it = DriveApp.getFolderById(pair[0]).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const ref = 'drive:' + f.getId();
      if (known[ref]) continue;
      if (since && f.getDateCreated() < since) continue;
      if (!OK_TYPE.test(f.getMimeType()) && !OK_NAME.test(f.getName())) continue;
      items.push({ ref: ref, source: 'drive', kind: pair[1], filename: f.getName(), mime: f.getMimeType(), size: f.getSize(),
        url: f.getUrl(), date: f.getDateCreated().toISOString() });
    }
  });
  return items;
}

function get_(ref) {
  const p = String(ref).split(':');
  if (p[0] === 'gmail') {
    const m = GmailApp.getMessageById(p[1]);
    const a = m.getAttachments({ includeInlineImages: false })[Number(p[2])];
    if (!a) throw new Error('A csatolmány nem található');
    if (/\.hei[cf]$/i.test(a.getName())) throw new Error('HEIC csatolmány: mentsd a Drive „Bejövő számlák” mappájába, onnan JPEG-ként jön át');
    return blob_(a.copyBlob(), a.getName());
  }
  if (p[0] === 'drive') {
    const f = DriveApp.getFileById(p[1]);
    if (/hei[cf]/i.test(f.getMimeType()) || /\.hei[cf]$/i.test(f.getName())) {
      // HEIC → nagy felbontású JPEG a Drive előnézetéből
      const token = ScriptApp.getOAuthToken();
      const meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '?fields=thumbnailLink',
        { headers: { Authorization: 'Bearer ' + token } }).getContentText());
      if (!meta.thumbnailLink) throw new Error('A HEIC kép előnézete még nem készült el a Drive-on – próbáld újra pár perc múlva');
      const img = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s2400'), { headers: { Authorization: 'Bearer ' + token } });
      return blob_(img.getBlob(), f.getName().replace(/\.\w+$/, '.jpg'), 'image/jpeg');
    }
    return blob_(f.getBlob(), f.getName());
  }
  throw new Error('Ismeretlen hivatkozás: ' + ref);
}

function blob_(b, name, mime) {
  return { data: Utilities.base64Encode(b.getBytes()), mime: mime || b.getContentType(), filename: name };
}

/** Szövegfelismerés: ideiglenes Google-dokumentum OCR-rel, a szöveg kiolvasása, majd a dokumentum törlése. */
function ocr_(req) {
  if (typeof Drive === 'undefined') throw new Error('A szövegfelismeréshez kapcsold be a szkriptben: Szolgáltatások (+) → Drive API → Hozzáadás, majd telepítsd újra (Telepítések kezelése → Új verzió).');
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'application/pdf', req.filename || 'bizonylat');
  const file = Drive.Files.create({ name: 'MM ERP OCR ' + (req.filename || ''), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'hu', fields: 'id' });
  try {
    return DocumentApp.openById(file.id).getBody().getText();
  } finally {
    try { DriveApp.getFileById(file.id).setTrashed(true); } catch (e) { /* a lomtárba helyezés nem kritikus */ }
  }
}
