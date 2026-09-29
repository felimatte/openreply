/**
 * The Google Apps Script that receives contact updates in a Google Sheet. The
 * settings page hands it out with the workspace's secret already filled in;
 * docs/contacts.md shows the same code with a placeholder.
 *
 * It keeps one row per contact, keyed by "Contact ID": new contacts are added,
 * known ones updated in place, deleted ones removed. A column is added for each
 * new custom field. It reads the sheet once and writes each of OpenReply's
 * columns in one call, so a big batch stays fast, and it never writes the
 * columns someone added by hand, formulas included.
 */
export function buildAppsScript(secret: string): string {
  return `// OpenReply -> Google Sheets
// Keeps this sheet up to date with your OpenReply contacts. Paste it in
// Extensions > Apps Script, then Deploy > New deployment > Web app, with
// "Execute as: Me" and "Who has access: Anyone". Paste the web app URL in
// OpenReply > Settings > Google Sheets.

const SECRET = ${JSON.stringify(secret)};
const SHEET_NAME = "Contacts";
const HEADERS = [
  "Contact ID", "Instagram account", "Instagram user ID", "Username", "Email",
  "Phone", "Tags", "Source campaign", "First seen", "Last interaction",
];
const MAX_AGE_MS = 10 * 60 * 1000;

function doPost(e) {
  try {
    const body = e && e.postData ? e.postData.contents : "";
    const signature = (e && e.parameter && e.parameter.signature) || "";
    if (!body || !sameText(signature, sign(body))) {
      return reply({ ok: false, error: "bad signature: copy the script again from OpenReply" });
    }
    const payload = JSON.parse(body);
    const sentAt = Date.parse(payload.sent_at);
    if (!sentAt || Math.abs(Date.now() - sentAt) > MAX_AGE_MS) {
      return reply({ ok: false, error: "request too old" });
    }
    if (payload.event === "test") return reply({ ok: true, test: true });

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = contactsSheet();
      if (payload.event === "contacts.updated") {
        upsertContacts(sheet, payload.contacts || []);
      } else if (payload.event === "contacts.deleted") {
        removeContacts(sheet, payload.contact_ids || []);
      } else {
        return reply({ ok: false, error: "unknown event: " + payload.event });
      }
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true });
  } catch (error) {
    return reply({ ok: false, error: String((error && error.message) || error) });
  }
}

function sign(body) {
  const bytes = Utilities.computeHmacSha256Signature(body, SECRET, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function contactsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function headersOf(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

const DATE_HEADERS = ["First seen", "Last interaction"];

// The value OpenReply has for a column, or undefined for a column it doesn't
// fill (one added by hand).
function valueFor(contact, header) {
  switch (header) {
    case "Contact ID": return contact.contact_id;
    case "Instagram account": return contact.instagram_account;
    case "Instagram user ID": return contact.instagram_user_id;
    case "Username": return contact.username;
    case "Email": return contact.email;
    case "Phone": return contact.phone;
    case "Tags": return (contact.tags || []).join(", ");
    case "Source campaign": return contact.source_campaign;
    case "First seen": return contact.first_seen;
    case "Last interaction": return contact.last_interaction;
  }
  const fields = contact.fields || {};
  return Object.prototype.hasOwnProperty.call(fields, header) ? fields[header] : undefined;
}

// Dates are written as dates. Everything else gets a leading apostrophe,
// which keeps it as typed: phone numbers keep their "+" and leading zeros,
// and nothing is ever read as a formula.
function asCell(header, value) {
  if (value === undefined || value === null || value === "") return "";
  if (DATE_HEADERS.indexOf(header) !== -1) return value instanceof Date ? value : new Date(value);
  return "'" + value;
}

function upsertContacts(sheet, contacts) {
  const headers = headersOf(sheet);
  const width = headers.length;
  contacts.forEach(function (contact) {
    Object.keys(contact.fields || {}).forEach(function (label) {
      if (headers.indexOf(label) === -1) headers.push(label);
    });
  });
  if (headers.length > width) {
    sheet.getRange(1, width + 1, 1, headers.length - width)
      .setValues([headers.slice(width)])
      .setFontWeight("bold");
  }

  const idColumn = headers.indexOf("Contact ID");
  if (idColumn === -1) throw new Error('The first row needs a "Contact ID" column');
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const rowOf = {};
  rows.forEach(function (row, i) { rowOf[String(row[idColumn])] = i; });

  const written = {};
  contacts.forEach(function (contact) {
    const id = String(contact.contact_id);
    if (!Object.prototype.hasOwnProperty.call(rowOf, id)) {
      rowOf[id] = rows.length;
      rows.push(headers.map(function () { return ""; }));
    }
    const row = rows[rowOf[id]];
    headers.forEach(function (header, c) {
      const value = valueFor(contact, header);
      if (value === undefined) return;
      row[c] = value;
      written[c] = true;
    });
  });

  // One write per OpenReply column, however many rows there are. Columns
  // added by hand are never written, so their values and formulas stay.
  Object.keys(written).forEach(function (key) {
    const c = Number(key);
    sheet.getRange(2, c + 1, rows.length, 1).setValues(rows.map(function (row) {
      return [asCell(headers[c], row[c])];
    }));
  });
}

function removeContacts(sheet, removedIds) {
  const idColumn = headersOf(sheet).indexOf("Contact ID") + 1;
  if (idColumn === 0) return;
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return;
  const ids = sheet.getRange(2, idColumn, rows, 1).getValues().map(function (row) {
    return String(row[0]);
  });
  // From the bottom up, so the rows still to check keep their numbers.
  for (let i = ids.length - 1; i >= 0; i--) {
    if (removedIds.indexOf(ids[i]) !== -1) sheet.deleteRow(i + 2);
  }
}
`;
}
