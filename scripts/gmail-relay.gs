/**
 * mogyorosi.erp – Gmail levéltovábbító (Google Apps Script web app), v3.9.8
 *
 * Miért kell: a Render ingyenes csomagja 2025 szeptembere óta tiltja a kimenő SMTP-t (25 / 465 / 587),
 * ezért az ERP a leveleket HTTPS-en adja át ennek a scriptnek, a script pedig a saját Gmail-fiókodból küldi el.
 * Ingyenes; magán Gmail-fióknál napi 100 címzett a keret.
 *
 * Beállítás (egyszer, kb. 5 perc):
 *  1. https://script.google.com → Új projekt → ide másold ezt a fájlt (a Kód.gs tartalma helyére), mentés.
 *  2. Projektbeállítások (fogaskerék) → Szkripttulajdonságok → Hozzáadás: SECRET = egy hosszú, véletlen jelszó.
 *  3. Telepítés → Új telepítés → Típus: Webalkalmazás → Végrehajtás: Én; Hozzáférés: Bárki → Telepítés,
 *     majd engedélyezd a Gmail-hozzáférést. Másold ki a webalkalmazás URL-jét (…/exec).
 *  4. Renderen (Environment): MAIL_RELAY_URL = az …/exec URL, MAIL_RELAY_SECRET = a 2. pontbeli SECRET.
 *     Az SMTP_* változók törölhetők. Mentés után a Render újraindul; a Próba gombbal ellenőrizhető.
 */
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
    if (!secret || req.secret !== secret) return json_({ ok: false, error: "Érvénytelen titkos kulcs (MAIL_RELAY_SECRET ≠ SECRET)." });
    if (!req.to || !req.subject) return json_({ ok: false, error: "Hiányzó címzett vagy tárgy." });
    var attachments = (req.attachments || []).map(function (a) {
      return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mimeType || "application/octet-stream", a.filename);
    });
    GmailApp.sendEmail(req.to, req.subject, req.text || "", {
      htmlBody: req.html || undefined,
      name: req.name || "mogyorosi.erp",
      attachments: attachments,
    });
    return json_({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json_({ ok: true, service: "mogyorosi.erp Gmail relay", remaining: MailApp.getRemainingDailyQuota() });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
