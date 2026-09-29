# Contacts

OpenReply keeps a contact for everyone who talks to a connected Instagram
account: people a campaign fires for when they comment, people who send the
account a DM, and people who tap a campaign's button. The **Contacts** page in
the dashboard lists them with the data they shared and their tags, and can
download them as an Excel or CSV file. A Google Sheet can be kept up to date
automatically.

Asking for data and adding tags are off until a campaign turns them on, and a
campaign that doesn't use them sends exactly the same DMs as before. Contacts
are recorded either way.

## What a contact holds

| Field | Where it comes from |
| --- | --- |
| Username | The comment that brought them in. DMs don't carry a username, so a contact who only ever sent DMs shows their Instagram user ID instead. |
| Email, phone | Their answer to a campaign that asked for it, or an edit on the Contacts page. |
| Custom fields | Free-text answers, saved in the field the campaign names (for example "City"). |
| Tags | Added by every campaign that fires for them, or by hand. |
| Source campaign | The first campaign that fired for them. |
| First seen, last interaction | When they first and last commented, messaged or tapped. |

A contact belongs to one connected Instagram account. Disconnecting the account
deletes its campaigns but keeps its contacts, and reconnecting the same account
brings them back together, since Instagram gives each person the same ID for the
same account.

## Asking for data

In the campaign editor, under **Contacts**, **ask for their data** asks one
question:

- **Email** or **phone number**. On a phone, Instagram shows the email or number
  from the person's profile under the question, so they can send it with one
  tap. Instagram hides that button on desktop and when the profile has none, so
  a typed answer always works too. Answers are checked for the right shape
  ("ana at gmail" is not an email) and saved as typed, trimmed; phone numbers
  are kept as digits, with the leading `+` if they had one.
- **Something else**: any text, saved in a custom field you name.

The question goes either:

- **In exchange for the link**: the question replaces the DM with the link, and
  the link is sent once they answer. On a comment without an opening DM, the
  question is the comment's one private reply.
- **After the link**: the question follows the DM with the link. On a comment
  without an opening DM it is added to that same message, because Instagram
  allows no second message after a private reply until the person answers, so
  the DM and the question together have to fit in 600 characters. The
  thank-you follow-up, if the campaign has one, waits for the answer.

While a question is waiting, the person's next DM is read as the answer and never
triggers a keyword campaign. An answer that doesn't look like an email or a
phone number gets the retry message (or the question again). After three tries
OpenReply stops asking and carries on as if they had answered, so nobody gets
stuck without their link.

A person has one question waiting at a time. If another campaign fires for them
while a question asked in exchange for a link is waiting, that campaign sends
its link right away instead of asking, so no link is ever held up by another
campaign's question.

An email or phone number asked for in exchange for the link waits for its
answer for a week: the answer itself reopens Instagram's 24-hour messaging
window, so a late answer still gets the link. Other questions stop waiting
after a day.

## Downloads

The Contacts page downloads the contacts that match the current search and
filters. The Excel file opens directly, with every value stored as text, so
phone numbers keep their `+` and leading zeros. The CSV file is UTF-8, comma
separated; a value that would start with `=`, `+`, `-` or `@` gets a leading
apostrophe so a spreadsheet never runs it as a formula, unless it is a plain
number such as a phone number.

## Keeping a Google Sheet up to date

1. In **Settings → Google Sheets**, choose **Set up**. OpenReply creates a secret
   and shows a script with it filled in. Copy the script.
2. Open the Google Sheet (a new one is best), then **Extensions → Apps Script**.
   Replace the code there with the script and save.
3. Choose **Deploy → New deployment**. Select the type **Web app**, set
   **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. Google
   asks to authorize the script the first time.
4. Copy the **Web app URL**, paste it in OpenReply and save. OpenReply sends a
   test request to check the connection.
5. **Send all contacts** fills the sheet with the contacts you already have.

From then on, a new contact, a new answer or a new tag updates the sheet within
seconds, in a sheet named **Contacts**. Rows are matched by **Contact ID**.
Columns you add by hand are left alone, formulas included. A value cleared in
OpenReply is cleared in the sheet, and deleting a contact removes its row. If
the sheet can't be reached, OpenReply retries for about 15 minutes and shows
the last error in Settings.

If you edit the script later, deploy a new version (**Deploy → Manage
deployments → Edit → New version**) so the URL keeps serving the latest code.

### Using another tool

The same updates can go to any tool that accepts a webhook (Make, Zapier, n8n,
your own server): paste its URL instead of a Google Sheet's. Each update is an
HTTPS `POST` with a JSON body:

```json
{
  "event": "contacts.updated",
  "sent_at": "2026-09-29T15:04:05.000Z",
  "workspace_id": "cm1...",
  "contacts": [
    {
      "contact_id": "cm2...",
      "instagram_account": "yourbrand",
      "instagram_user_id": "1784...",
      "username": "ana",
      "email": "ana@example.com",
      "phone": "+5491123456789",
      "tags": ["guide", "vip"],
      "source_campaign": "Guide October",
      "first_seen": "2026-09-29T15:03:00.000Z",
      "last_interaction": "2026-09-29T15:04:00.000Z",
      "fields": { "City": "Rosario" }
    }
  ]
}
```

A deleted contact arrives as `{"event": "contacts.deleted", "contact_ids": [...]}`,
and the connection test as `{"event": "test"}`. Every custom field is included,
keyed by its name as shown in OpenReply, and empty when the contact has no value.

The URL has to be a public `https` address. OpenReply checks where its name
points, and where any redirect goes, before sending anything, and never sends
to the server itself or a private network.

Every request is signed with the secret from Settings: the hex HMAC-SHA256 of
the raw body is sent in the `X-OpenReply-Signature` header as `sha256=<hex>`,
and again in the `signature` query parameter for tools that can't read
headers. Check it before trusting a request, and ignore requests whose
`sent_at` is more than a few minutes old. Any 2xx answer counts as delivered,
unless the body is JSON with `"ok": false`.

### The script

This is the script Settings hands out, with your secret in place of the
placeholder:

```js
// OpenReply -> Google Sheets
// Keeps this sheet up to date with your OpenReply contacts. Paste it in
// Extensions > Apps Script, then Deploy > New deployment > Web app, with
// "Execute as: Me" and "Who has access: Anyone". Paste the web app URL in
// OpenReply > Settings > Google Sheets.

const SECRET = "PASTE_YOUR_SECRET_HERE";
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
```

## Privacy

Contacts hold personal data that people chose to share in a conversation with
the account. Delete a contact from the Contacts page when someone asks you to;
their row in a synced sheet goes with it. Deleting the workspace deletes all of
its contacts.
