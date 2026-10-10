/**
 * BSKT Registru — READ-ONLY link between the owners' spreadsheet and https://geezfully.com/bskt-registru/
 *
 * This version lives in YOUR OWN Google Drive (a standalone Apps Script project), not inside the owners' file:
 * nothing is added to their spreadsheet. It reads it by ID through Google's built-in Sheets service ("Sheets", the
 * Sheets API v4 advanced service, switched on by appsscript.json) with your account's access.
 *
 * Read-only by construction:
 *   - it only calls the Sheets service's READ methods (Spreadsheets.get, Spreadsheets.Values.batchGet) — no write call exists;
 *   - appsscript.json limits the script to Google's READ-ONLY spreadsheet permission
 *     (https://www.googleapis.com/auth/spreadsheets.readonly). Even if code tried to write, Google would refuse.
 *   (SpreadsheetApp.openById is deliberately NOT used: Google requires the full read/write permission for it.)
 *
 * Setup:
 *   1. script.google.com → New project → paste this file into Code.gs (replace its content) → put the
 *      spreadsheet's ID in SHEET_ID below → Save.
 *   2. Project Settings (gear) → tick "Show appsscript.json manifest file in editor" → open appsscript.json →
 *      replace its content with the appsscript.json from this folder → Save.
 *   3. Project Settings → Script properties → Add: CHEIE = <the key from the app, Setări → Tabel Google>.
 *   4. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy → approve.
 *      The permission screen must only say "See all your Google Sheets spreadsheets" (read only) — nothing about edit/delete.
 *   5. Copy the web-app URL (…/exec) into the app (Setări → Tabel Google).
 * After editing this script later: Deploy → Manage deployments → edit → Version: New version (URL stays the same).
 */

// the owners' spreadsheet: docs.google.com/spreadsheets/d/<THIS PART>/edit
const SHEET_ID = 'PASTE_THE_SHEET_ID_HERE';   // kept out of the public repo
const SHEET_RESULTS = 'Results';
const SHEET_PLAYERS = 'Player data';
const DAY_SHEET = /^PD_\d{2}\.\d{2}\.\d{4}$/;   // PD_07.10.2026 — "…_old", "Archive…" and "Day template" are ignored

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('CHEIE');
  if (!key || !e || !e.parameter || e.parameter.cheie !== key) return out_({ error: 'unauthorized' });

  const titles = Sheets.Spreadsheets.get(SHEET_ID, { fields: 'sheets.properties.title' }).sheets.map(s => s.properties.title);
  const days = titles.filter(t => DAY_SHEET.test(t));
  const ranges = [`'${SHEET_RESULTS}'!B3:O`, `'${SHEET_PLAYERS}'!B2:D`].concat(days.map(t => `'${t}'!A1:T`));
  // the same cells twice: as shown in the sheet, and as stored (dates/times as day numbers — exact, no timezone)
  const shown = batch_(ranges, 'FORMATTED_VALUE');
  const raw = batch_(ranges, 'UNFORMATTED_VALUE');

  return out_({
    generat: new Date().toISOString(),
    rezultate: results_(shown[0], raw[0]),
    jucatori: (shown[1] || []).map(r => [cell_(r, 0), cell_(r, 1), cell_(r, 2)]).filter(r => r[0] !== ''),
    zile: days.map((t, i) => ({ foaie: t, blocuri: blocks_(shown[i + 2] || [], raw[i + 2] || []) })),
  });
}

// ── Sheets service, read methods only ──
function batch_(ranges, render) {
  const data = Sheets.Spreadsheets.Values.batchGet(SHEET_ID,
    { ranges: ranges, majorDimension: 'ROWS', valueRenderOption: render, dateTimeRenderOption: 'SERIAL_NUMBER' });
  return (data.valueRanges || []).map(v => v.values || []);
}
const cell_ = (row, c) => (row && row[c] !== undefined && row[c] !== null) ? String(row[c]).trim() : '';

// Results: [Match#, Date, Time MD, Time (KYIV), Match status, Team 1, Team 2, reg1, reg2, ot1, ot2, res1, res2, Winner]
function results_(shown, raw) {
  return shown.map((r, i) => {
    const row = [];
    for (let c = 0; c < 14; c++) {
      const v = cell_(r, c), x = raw[i] ? raw[i][c] : undefined;
      row.push(c === 1 ? date_(x, v) : (c === 2 || c === 3) ? time_(x, v) : v);
    }
    return row;
  }).filter(r => r[0] !== '' && r[5] !== '' && r[6] !== '');
}

// day sheet: a block starts at a row whose column A is "Match#"; teams on the next row (A and J);
// four player rows start 4 rows below (jersey, name, level in A–C and J–L)
// A block is also recognised by its layout ("Start time" in C, "Jersey#" two rows down), because the "Match#"
// label is sometimes typed over by accident (PD_08.10.2026 had a space there and its first game was missed).
function isBlock_(v, r) {
  if (!cell_(v[r + 1], 0)) return false;
  return cell_(v[r], 0) === 'Match#' || (cell_(v[r], 2) === 'Start time' && cell_(v[r + 2], 0) === 'Jersey#');
}
function blocks_(v, raw) {
  const out = [];
  for (let r = 0; r < v.length; r++) {
    if (!isBlock_(v, r)) continue;
    const side = (c) => [4, 5, 6, 7].map(k => [cell_(v[r + k], c), cell_(v[r + k], c + 1), cell_(v[r + k], c + 2)]).filter(p => p[1] !== '');
    out.push({ nr: cell_(v[r], 1), data: date_(raw[r] && raw[r][3], cell_(v[r], 3)), ora: time_(raw[r] && raw[r][10], cell_(v[r], 10)),
               castigator: cell_(v[r], 15), a: cell_(v[r + 1], 0), b: cell_(v[r + 1], 9), jucA: side(0), jucB: side(9) });
  }
  return out;
}

// Stored dates/times are day numbers (days since 30.12.1899; the fraction is the time of day) — exact, no timezone.
// Text cells (e.g. a date typed as "29.09.2026") fall back to what is shown.
function date_(x, shown) {
  if (typeof x !== 'number' || x < 1) return shown;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(x) * 86400000);
  const p = (n) => ('0' + n).slice(-2);
  return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}
function time_(x, shown) {
  const p = (n) => ('0' + n).slice(-2);
  if (typeof x === 'number') {
    const min = Math.round((x - Math.floor(x)) * 1440) % 1440;
    return p(Math.floor(min / 60)) + ':' + p(min % 60);
  }
  const m = String(shown || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return String(shown || '').trim();
  let h = Number(m[1]);
  if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return p(h) + ':' + m[2];
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
