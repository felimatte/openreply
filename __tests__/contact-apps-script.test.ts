/**
 * Runs the Google Apps Script that receives contact updates against a small
 * in-memory stand-in for the Sheets services it uses, fed with requests signed
 * exactly as lib/contacts/sync.ts signs them.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (value: string) => value }));
vi.mock("@/lib/queue/client", () => ({
  CONTACT_SYNC_JOB_NAME: "sync-contacts",
  getContactSyncQueue: vi.fn(),
}));

import { buildAppsScript } from "../lib/contacts/apps-script";
import {
  serializeContactSyncPayload,
  signContactSyncBody,
  type ContactSyncPayload,
  type ContactSyncRecord,
} from "../lib/contacts/sync";

const SECRET = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4";

interface FakeRange {
  getValues(): unknown[][];
  setValues(values: unknown[][]): FakeRange;
  setValue(value: unknown): FakeRange;
  setFontWeight(): FakeRange;
}

/** Just enough of a Google Sheet: a grid of values, 1-indexed. */
class FakeSheet {
  rows: unknown[][] = [];
  frozenRows = 0;
  // Every call that writes to the sheet, the slow part of an Apps Script.
  writes = 0;

  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return Math.max(0, ...this.rows.map((row) => row.length));
  }
  appendRow(values: unknown[]) {
    this.rows.push(values.map(stored));
  }
  setFrozenRows(count: number) {
    this.frozenRows = count;
  }
  deleteRow(row: number) {
    this.rows.splice(row - 1, 1);
  }
  getRange(row: number, column: number, numRows = 1, numColumns = 1): FakeRange {
    if (row < 1 || column < 1) throw new Error("Range out of bounds");
    const range: FakeRange = {
      getValues: () =>
        Array.from({ length: numRows }, (_, r) =>
          Array.from(
            { length: numColumns },
            (_, c) => this.rows[row - 1 + r]?.[column - 1 + c] ?? ""
          )
        ),
      setValues: (values) => {
        this.writes += 1;
        values.forEach((line, r) =>
          line.forEach((value, c) => this.set(row + r, column + c, value))
        );
        return range;
      },
      setValue: (value) => {
        this.writes += 1;
        this.set(row, column, value);
        return range;
      },
      setFontWeight: () => range,
    };
    return range;
  }
  set(row: number, column: number, value: unknown) {
    while (this.rows.length < row) this.rows.push([]);
    const line = this.rows[row - 1];
    while (line.length < column) line.push("");
    line[column - 1] = stored(value);
  }
}

// Sheets keeps a leading apostrophe out of the value: it only marks text.
// Anything else starting with "=" would be run as a formula.
function stored(value: unknown) {
  if (typeof value !== "string") return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith("=")) return { formula: value };
  return value;
}

function loadScript(secret = SECRET) {
  const sheets = new Map<string, FakeSheet>();
  const sandbox: Record<string, unknown> = {
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      // Apps Script returns Java bytes: signed, -128 to 127.
      computeHmacSha256Signature: (value: string, key: string) =>
        Array.from(createHmac("sha256", key).update(value, "utf8").digest()).map(
          (byte) => (byte > 127 ? byte - 256 : byte)
        ),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name: string) => sheets.get(name) ?? null,
        insertSheet: (name: string) => {
          const sheet = new FakeSheet();
          sheets.set(name, sheet);
          return sheet;
        },
      }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(buildAppsScript(secret), sandbox);
  const doPost = sandbox.doPost as (e: unknown) => { text: string };
  return {
    sheets,
    post(payload: ContactSyncPayload, signWith = SECRET) {
      const body = serializeContactSyncPayload(payload);
      const result = doPost({
        postData: { contents: body },
        parameter: { signature: signContactSyncBody(body, signWith) },
      });
      return JSON.parse(result.text) as { ok: boolean; error?: string };
    },
  };
}

function contact(overrides: Partial<ContactSyncRecord> = {}): ContactSyncRecord {
  return {
    contact_id: "contact_1",
    instagram_account: "felimattee",
    instagram_user_id: "person_1",
    username: "ana",
    email: "ana@example.com",
    phone: "+5491123456789",
    tags: ["guía", "vip"],
    source_campaign: "Guide October",
    first_seen: "2026-09-29T12:00:00.000Z",
    last_interaction: "2026-09-29T12:05:00.000Z",
    fields: {},
    ...overrides,
  };
}

function updated(contacts: ContactSyncRecord[]): ContactSyncPayload {
  return {
    event: "contacts.updated",
    sent_at: new Date().toISOString(),
    workspace_id: "workspace_123",
    contacts,
  };
}

let script: ReturnType<typeof loadScript>;

beforeEach(() => {
  script = loadScript();
});

describe("the Apps Script", () => {
  it("answers a test request without touching the sheet", () => {
    expect(
      script.post({ event: "test", sent_at: new Date().toISOString(), workspace_id: "w" })
    ).toEqual({ ok: true, test: true });
    expect(script.sheets.size).toBe(0);
  });

  it("refuses a request signed with another secret", () => {
    const result = script.post(updated([contact()]), "someone-else");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("bad signature");
    expect(script.sheets.size).toBe(0);
  });

  it("refuses a replayed old request", () => {
    const result = script.post({
      ...updated([contact()]),
      sent_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(result).toEqual({ ok: false, error: "request too old" });
  });

  it("creates the sheet with a header and one row per contact", () => {
    expect(
      script.post(updated([contact(), contact({ contact_id: "contact_2", username: "bruno", phone: "01145678901" })]))
    ).toEqual({ ok: true });

    const sheet = script.sheets.get("Contacts")!;
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.rows[0]).toEqual([
      "Contact ID", "Instagram account", "Instagram user ID", "Username", "Email",
      "Phone", "Tags", "Source campaign", "First seen", "Last interaction",
    ]);
    expect(sheet.rows[1].slice(0, 8)).toEqual([
      "contact_1", "felimattee", "person_1", "ana", "ana@example.com",
      "+5491123456789", "guía, vip", "Guide October",
    ]);
    expect(sheet.rows[1][8]).toEqual(new Date("2026-09-29T12:00:00.000Z"));
    // The leading zero survives: the value was written as text.
    expect(sheet.rows[2][5]).toBe("01145678901");
  });

  it("carries accents and emoji through the signature", () => {
    expect(script.post(updated([contact({ username: "ñandú 😀" })]))).toEqual({ ok: true });
    expect(script.sheets.get("Contacts")!.rows[1][3]).toBe("ñandú 😀");
  });

  it("updates a known contact in place and adds a column for a new field", () => {
    script.post(updated([contact()]));
    script.post(updated([contact({ email: "new@example.com", fields: { Ciudad: "Rosario" } })]));

    const sheet = script.sheets.get("Contacts")!;
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0][10]).toBe("Ciudad");
    expect(sheet.rows[1][4]).toBe("new@example.com");
    expect(sheet.rows[1][10]).toBe("Rosario");
  });

  it("leaves columns added by hand alone", () => {
    script.post(updated([contact()]));
    const sheet = script.sheets.get("Contacts")!;
    sheet.set(1, 11, "Notes");
    sheet.set(2, 11, "called on Monday");

    script.post(updated([contact({ username: "ana.p" })]));

    expect(sheet.rows[1][3]).toBe("ana.p");
    expect(sheet.rows[1][10]).toBe("called on Monday");
  });

  it("keeps formulas added by hand in their own columns", () => {
    script.post(updated([contact()]));
    const sheet = script.sheets.get("Contacts")!;
    sheet.set(1, 11, "Email length");
    sheet.set(2, 11, "=LEN(E2)");

    script.post(updated([contact({ email: "longer.address@example.com" })]));

    expect(sheet.rows[1][4]).toBe("longer.address@example.com");
    expect(sheet.rows[1][10]).toEqual({ formula: "=LEN(E2)" });
  });

  it("clears a value that was emptied in OpenReply", () => {
    script.post(updated([contact({ fields: { Ciudad: "Rosario" } })]));
    script.post(updated([contact({ phone: "", fields: { Ciudad: "" } })]));

    const sheet = script.sheets.get("Contacts")!;
    expect(sheet.rows[1][5]).toBe("");
    expect(sheet.rows[1][10]).toBe("");
  });

  it("keeps the other contacts' phone numbers as text when it rewrites a column", () => {
    script.post(updated([contact({ contact_id: "a", phone: "01145678901" })]));
    script.post(updated([contact({ contact_id: "b", phone: "+5491100000000" })]));

    const sheet = script.sheets.get("Contacts")!;
    // Row "a" was rewritten along with "b"; its leading zero is still there.
    expect(sheet.rows[1][5]).toBe("01145678901");
    expect(sheet.rows[2][5]).toBe("+5491100000000");
  });

  it("writes a full batch in a handful of calls, whatever its size", () => {
    const batch = Array.from({ length: 200 }, (_, i) =>
      contact({ contact_id: `c${i}`, fields: { Ciudad: `City ${i}` } })
    );
    expect(script.post(updated(batch))).toEqual({ ok: true });
    const sheet = script.sheets.get("Contacts")!;
    expect(sheet.rows).toHaveLength(201);
    expect(sheet.writes).toBeLessThanOrEqual(14);

    sheet.writes = 0;
    script.post(updated(batch.map((c) => ({ ...c, email: "changed@example.com" }))));
    expect(sheet.rows).toHaveLength(201);
    expect(sheet.writes).toBeLessThanOrEqual(12);
    expect(sheet.rows[200][4]).toBe("changed@example.com");
  });

  it("never writes a value that Sheets would run as a formula", () => {
    script.post(updated([contact({ username: "=IMPORTXML(\"http://evil\")" })]));
    // Stored with the text marker, so the sheet shows it and never evaluates it.
    expect(script.sheets.get("Contacts")!.rows[1][3]).toBe('=IMPORTXML("http://evil")');
  });

  it("removes deleted contacts", () => {
    script.post(
      updated([contact(), contact({ contact_id: "contact_2" }), contact({ contact_id: "contact_3" })])
    );
    expect(
      script.post({
        event: "contacts.deleted",
        sent_at: new Date().toISOString(),
        workspace_id: "workspace_123",
        contact_ids: ["contact_1", "contact_3"],
      })
    ).toEqual({ ok: true });

    const ids = script.sheets.get("Contacts")!.rows.slice(1).map((row) => row[0]);
    expect(ids).toEqual(["contact_2"]);
  });
});

describe("docs/contacts.md", () => {
  it("shows the same script the settings page hands out", () => {
    const doc = readFileSync(path.join(__dirname, "..", "docs", "contacts.md"), "utf8");
    const block = doc.match(/```js\n([\s\S]*?)```/);
    expect(block?.[1]).toBe(buildAppsScript("PASTE_YOUR_SECRET_HERE"));
  });
});
