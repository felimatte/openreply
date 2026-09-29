import { describe, it, expect } from "vitest";
import {
  RESERVED_FIELD_KEYS,
  fieldKeyFromLabel,
  normalizeTagNames,
  parseAnswer,
  parseEmail,
  parsePhone,
  parseTextAnswer,
} from "../lib/contacts/answers";
import { asFieldValues } from "../lib/contacts/format";

describe("parseEmail", () => {
  it.each([
    ["ana@example.com", "ana@example.com"],
    ["  Ana.Perez+promo@Mail.Example.COM ", "ana.perez+promo@mail.example.com"],
    ["sure! my email is ana@example.com, thanks", "ana@example.com"],
    ["ana@example.com.", "ana@example.com"],
    ["mi mail: juan_2@sub.dominio.com.ar", "juan_2@sub.dominio.com.ar"],
  ])("reads %j as %j", (text, expected) => {
    expect(parseEmail(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    "GUIDE",
    "ana@",
    "@example.com",
    "ana@example",
    "ana at example dot com",
    ".ana@example.com",
    "ana.@example.com",
    "an..a@example.com",
    `${"a".repeat(65)}@example.com`,
    "",
  ])("rejects %j", (text) => {
    expect(parseEmail(text)).toEqual({ ok: false });
  });
});

describe("parsePhone", () => {
  it.each([
    ["+54 9 11 2345-6789", "+5491123456789"],
    ["11 2345 6789", "1123456789"],
    ["(011) 4567-8901", "01145678901"],
    ["my number is 11-2345-6789, call after 6", "1123456789"],
    ["+5491123456789", "+5491123456789"],
    ["1123.4567.89", "1123456789"],
  ])("reads %j as %j", (text, expected) => {
    expect(parsePhone(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    "1234",
    "1234567",
    "call me",
    "29/09/2026",
    "+1 234 567 890 123 456 789",
    "",
  ])("rejects %j", (text) => {
    expect(parsePhone(text)).toEqual({ ok: false });
  });
});

describe("parseTextAnswer", () => {
  it("keeps the trimmed text", () => {
    expect(parseTextAnswer("  Rosario  ")).toEqual({ ok: true, value: "Rosario" });
  });

  it("rejects an empty answer", () => {
    expect(parseTextAnswer("   ")).toEqual({ ok: false });
  });

  it("caps very long answers", () => {
    const result = parseTextAnswer("x".repeat(2000));
    expect(result.ok && result.value.length).toBe(500);
  });
});

describe("parseAnswer", () => {
  it("dispatches by the question's type", () => {
    expect(parseAnswer("EMAIL", "ana@example.com")).toEqual({ ok: true, value: "ana@example.com" });
    expect(parseAnswer("PHONE", "11 2345 6789")).toEqual({ ok: true, value: "1123456789" });
    // Any text is a valid free-text answer, even one that looks like a keyword.
    expect(parseAnswer("TEXT", "GUIDE")).toEqual({ ok: true, value: "GUIDE" });
  });
});

describe("normalizeTagNames", () => {
  it("trims, collapses spaces and drops blanks and repeats", () => {
    expect(normalizeTagNames([" vip ", "guide  oct", "", "vip", "  "])).toEqual([
      "vip",
      "guide oct",
    ]);
  });

  it("caps a tag at 50 characters", () => {
    expect(normalizeTagNames(["t".repeat(80)])[0]).toHaveLength(50);
  });
});

describe("fieldKeyFromLabel", () => {
  it.each([
    ["City", "city"],
    ["Ciudad de envío", "ciudad_de_envio"],
    ["  ¿Qué talle usás?  ", "que_talle_usas"],
    ["Instagram — handle #2", "instagram_handle_2"],
    ["😀", ""],
  ])("turns %j into %j", (label, key) => {
    expect(fieldKeyFromLabel(label)).toBe(key);
  });

  it("reserves keys that would clash with built-in columns or JavaScript objects", () => {
    for (const label of ["Email", "Phone", "Tags", "Constructor", "Username"]) {
      expect(RESERVED_FIELD_KEYS.has(fieldKeyFromLabel(label)), label).toBe(true);
    }
    expect(RESERVED_FIELD_KEYS.has(fieldKeyFromLabel("City"))).toBe(false);
  });
});

describe("asFieldValues", () => {
  it("keeps string values and drops anything else", () => {
    expect({ ...asFieldValues({ city: "Rosario", size: 42, list: ["a"] }) }).toEqual({
      city: "Rosario",
    });
    expect({ ...asFieldValues(null) }).toEqual({});
    expect({ ...asFieldValues(["a"]) }).toEqual({});
  });

  it("never finds an inherited property", () => {
    expect(asFieldValues({})["constructor"]).toBeUndefined();
    expect(asFieldValues({})["toString"]).toBeUndefined();
  });
});
