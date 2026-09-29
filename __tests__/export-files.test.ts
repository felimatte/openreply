import { inflateRawSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { toCsv } from "../lib/utils/csv";
import { columnName, crc32, toXlsx } from "../lib/utils/xlsx";

/** Read a zip the way any unzipper does: from its central directory. */
function unzip(buffer: Buffer): Map<string, string> {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(endAt).toBeGreaterThan(0);
  const entries = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < entries; i++) {
    expect(buffer.readUInt32LE(at)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");

    expect(buffer.readUInt32LE(localAt)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(localAt + 26);
    const dataAt = localAt + 30 + localNameLength;
    const data = buffer.subarray(dataAt, dataAt + compressedSize);
    const content = method === 8 ? inflateRawSync(data) : data;

    expect(content.length).toBe(size);
    expect(crc32(content)).toBe(crc);
    files.set(name, content.toString("utf8"));
    at += 46 + nameLength;
  }
  return files;
}

describe("toCsv", () => {
  it("writes a UTF-8 byte order mark and CRLF lines", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("﻿a,b\r\n1,2\r\n");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv([['say "hi", then\nleave']])).toBe('﻿"say ""hi"", then\nleave"\r\n');
  });

  it("keeps accents and emoji", () => {
    expect(toCsv([["Rosario 😀 ñandú"]])).toBe("﻿Rosario 😀 ñandú\r\n");
  });

  it("never lets a cell open as a formula", () => {
    const csv = toCsv([
      ["=HYPERLINK(\"http://evil\")", "+SUM(1)", "-cmd|' /C calc'!A0", "@SUM(A1)", "ok"],
    ]);
    expect(csv).toBe(
      '﻿"\'=HYPERLINK(""http://evil"")",\'+SUM(1),\'-cmd|\' /C calc\'!A0,\'@SUM(A1),ok\r\n'
    );
  });

  it("leaves plain numbers such as phone numbers as they are", () => {
    expect(toCsv([["+5491123456789", "+54 (11) 2345-6789", "-1"]])).toBe(
      "﻿+5491123456789,+54 (11) 2345-6789,-1\r\n"
    );
  });
});

describe("toXlsx", () => {
  it("names columns like Excel", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      "A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA",
    ]);
  });

  it("builds a valid zip with every part a workbook needs", () => {
    const files = unzip(toXlsx([["Name", "Email"], ["Ana", "ana@example.com"]], "Contacts"));
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Contacts" sheetId="1" r:id="rId1"/>');
  });

  it("writes every value as text, header in bold", () => {
    const sheet = unzip(toXlsx([["Phone"], ["+5491123456789"], ["=1+1"]])).get(
      "xl/worksheets/sheet1.xml"
    )!;
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Phone</t></is></c>'
    );
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">+5491123456789</t></is></c>'
    );
    // Stored as the text "=1+1", not as a formula.
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>');
    expect(sheet).not.toContain("<f>");
  });

  it("escapes markup and drops characters XML can't hold", () => {
    const sheet = unzip(toXlsx([["<b>&co</b>\u0007 ok 😀 \ud800"]])).get(
      "xl/worksheets/sheet1.xml"
    )!;
    expect(sheet).toContain(">&lt;b&gt;&amp;co&lt;/b&gt; ok 😀 </t>");
  });

  it("skips empty cells but keeps their column positions", () => {
    const sheet = unzip(toXlsx([["a", "", "c"]])).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A1"');
    expect(sheet).not.toContain('<c r="B1"');
    expect(sheet).toContain('<c r="C1"');
  });

  it("cleans a sheet name Excel would refuse", () => {
    const workbook = unzip(toXlsx([["x"]], "Contacts: [all] / 2026 and a very long tail")).get(
      "xl/workbook.xml"
    )!;
    // Forbidden characters become spaces, then the name is cut to 31.
    expect(workbook).toContain('<sheet name="Contacts   all    2026 and a ve" ');
  });
});
