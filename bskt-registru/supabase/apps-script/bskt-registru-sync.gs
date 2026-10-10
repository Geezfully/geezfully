/**
 * @OnlyCurrentDoc
 * (tells Google the script only needs THIS spreadsheet, so it never asks for access to all of the owner's sheets)
 */
/**
 * BSKT Registru — read-only link between this spreadsheet and https://geezfully.com/bskt-registru/
 *
 * The registry app fetches this script's web-app URL every few minutes. The script answers only when the
 * request carries the secret key (set in Script properties as CHEIE), and it never changes the spreadsheet.
 *
 * Setup (once, by someone with edit access to the spreadsheet):
 *   1. Extensions → Apps Script → "+" next to Files → Script → name it bskt-registru-sync → paste this file there → Save.
 *      Put it in a NEW file: never replace or edit the scripts already in the project (e.g. updatePlayerData).
 *      Nothing here writes to the spreadsheet — the app only ever calls doGet(), which reads.
 *   2. Project Settings (gear) → Script properties → Add: CHEIE = <the key shown in the app, Setări → Tabel Google>.
 *   3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy → Authorize.
 *   4. Copy the web-app URL (…/exec) and paste it in the app (Setări → Tabel Google).
 * After editing this script later: Deploy → Manage deployments → edit → Version: New version (the URL stays the same).
 */

const SHEET_RESULTS = 'Results';
const SHEET_PLAYERS = 'Player data';
const DAY_SHEET = /^PD_\d{2}\.\d{2}\.\d{4}$/;   // PD_07.10.2026 — "…_old", "Archive…" and "Day template" are ignored

let TZ_ = 'Europe/Chisinau';

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('CHEIE');
  if (!key || !e || !e.parameter || e.parameter.cheie !== key) return out_({ error: 'unauthorized' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  TZ_ = ss.getSpreadsheetTimeZone() || TZ_;
  return out_({
    generat: new Date().toISOString(),
    rezultate: results_(ss),
    zile: days_(ss),
    jucatori: players_(ss),
  });
}

// Results: [Match#, Date, Time MD, Time (KYIV), Match status, Team 1, Team 2, reg1, reg2, ot1, ot2, res1, res2, Winner]
function results_(ss) {
  const sh = ss.getSheetByName(SHEET_RESULTS);
  if (!sh || sh.getLastRow() < 3) return [];
  const range = sh.getRange(3, 2, sh.getLastRow() - 2, 14);
  const raw = range.getValues(), shown = range.getDisplayValues();
  return shown.map((r, i) => r.map((v, c) => c === 1 ? date_(raw[i][c], v) : (c === 2 || c === 3) ? time_(raw[i][c], v) : v))
    .filter(r => r[0] !== '' && r[5] !== '' && r[6] !== '');
}

// One entry per day sheet: { foaie, blocuri: [{ nr, data, ora, castigator, a, b, jucA: [[nr, nume, nivel]], jucB }] }
function days_(ss) {
  return ss.getSheets().filter(sh => DAY_SHEET.test(sh.getName())).map(sh => {
    const range = sh.getDataRange();
    const v = range.getDisplayValues(), raw = range.getValues();
    const blocuri = [];
    for (let r = 0; r + 7 < v.length; r++) {
      // recognised by "Match#" in A, or by its layout when that label was typed over ("Start time" in C, "Jersey#" 2 rows down)
      if (!v[r + 1][0] || (v[r][0] !== 'Match#' && !(v[r][2] === 'Start time' && v[r + 2][0] === 'Jersey#'))) continue;
      const side = (c) => [4, 5, 6, 7].map(k => [v[r + k][c], v[r + k][c + 1], v[r + k][c + 2]]).filter(p => p[1] !== '');
      blocuri.push({ nr: v[r][1], data: date_(raw[r][3], v[r][3]), ora: time_(raw[r][10], v[r][10]), castigator: v[r][15],
                     a: v[r + 1][0], b: v[r + 1][9], jucA: side(0), jucB: side(9) });
    }
    return { foaie: sh.getName(), blocuri };
  });
}

// Player data: [Name, Level, Team]
function players_(ss) {
  const sh = ss.getSheetByName(SHEET_PLAYERS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 2, sh.getLastRow() - 1, 3).getDisplayValues().filter(r => r[0] !== '');
}

// Dates and times go out as "dd.MM.yyyy" / "HH:mm" regardless of the spreadsheet's locale (a US locale would show 10/7/2026)
function date_(raw, shown) {
  return raw instanceof Date ? Utilities.formatDate(raw, TZ_, 'dd.MM.yyyy') : String(shown || '').trim();
}
// Times: the day sheets format start times as 12-hour WITHOUT am/pm ("6:00" for 18:00), so the shown text alone is
// ambiguous. Minutes come from what is shown; morning vs evening comes from the stored value. A time-only cell is a date
// in 1899, and converting that through a timezone can be off by a few minutes (historical offsets), so the stored value
// only picks whichever reading — h or h+12 — is closer; it never supplies the minutes itself.
function time_(raw, shown) {
  const t = String(shown || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  const pad = (n) => ('0' + n).slice(-2);
  if (m && m[3]) {                                    // explicit AM/PM
    let h = Number(m[1]); const pm = /p/i.test(m[3]);
    if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0;
    return pad(h) + ':' + m[2];
  }
  if (!(raw instanceof Date)) return m ? pad(Number(m[1])) + ':' + m[2] : t;
  const f = Utilities.formatDate(raw, TZ_, 'HH:mm:ss').split(':').map(Number);
  const rawMin = f[0] * 60 + f[1] + f[2] / 60;
  if (!m) { const r = Math.round(rawMin) % 1440; return pad(Math.floor(r / 60)) + ':' + pad(r % 60); }
  const h = Number(m[1]) % 12, mi = Number(m[2]);
  const dist = (x) => Math.min(Math.abs(x - rawMin), 1440 - Math.abs(x - rawMin));
  const am = h * 60 + mi, pm = (h + 12) * 60 + mi;
  const best = Number(m[1]) >= 13 || dist(pm) < dist(am) ? (Number(m[1]) >= 13 ? Number(m[1]) * 60 + mi : pm) : am;
  return pad(Math.floor(best / 60)) + ':' + m[2];
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
