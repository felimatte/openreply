import { describe, expect, it } from "vitest";
import { createDefaultFlow, parseFlowDefinition } from "@/lib/flows/definition";
import {
  durationFromMinutes,
  durationToMinutes,
  formatDelayDuration,
  getDurationUnit,
  MAX_DELAY_MINUTES,
  type DurationUnit,
} from "@/lib/flows/duration";

function graphWithDelay(data: Record<string, unknown>) {
  const graph = createDefaultFlow();
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "resource" ? { ...node, type: "delay", data } : node),
  };
}

describe("delay duration units", () => {
  it.each([
    [30, "seconds", 0.5],
    [5, "minutes", 5],
    [2, "hours", 120],
    [1.5, "hours", 90],
  ] as const)("stores %s %s as %s canonical minutes and converts back", (value, unit, minutes) => {
    expect(durationToMinutes(value, unit)).toBeCloseTo(minutes, 10);
    expect(durationFromMinutes(minutes, unit)).toBeCloseTo(value, 10);
  });

  it("keeps fractions when changing the displayed unit", () => {
    const minutes = durationToMinutes(30, "seconds");
    expect(durationFromMinutes(minutes, "hours")).toBeCloseTo(1 / 120, 10);
    expect(durationToMinutes(durationFromMinutes(minutes, "hours"), "hours")).toBeCloseTo(minutes, 10);
  });

  it.each([
    [0, "minutes"],
    [0.5, "seconds"],
    [1, "minutes"],
    [5, "minutes"],
    [60, "hours"],
    [120, "hours"],
    [90, "minutes"],
    [60.5, "minutes"],
  ] as const)("infers %s legacy minutes as %s without changing their value", (minutes, unit) => {
    const data = { minutes };
    expect(getDurationUnit(data)).toBe(unit);
    expect(data).toEqual({ minutes });
  });

  it.each(["seconds", "minutes", "hours"] as const)("preserves an explicit %s choice", (unit) => {
    expect(getDurationUnit({ minutes: 120, unit })).toBe(unit);
  });

  it.each([
    [{ minutes: 0.5 }, "30 segundos"],
    [{ minutes: 1 / 60 }, "1 segundo"],
    [{ minutes: 1 }, "1 minuto"],
    [{ minutes: 5 }, "5 minutos"],
    [{ minutes: 60 }, "1 hora"],
    [{ minutes: 120 }, "2 horas"],
    [{ minutes: 90, unit: "hours" }, "1,5 horas"],
    [{ minutes: 0.5, unit: "minutes" }, "0,5 minutos"],
    [{ minutes: 60, unit: "minutes" }, "60 minutos"],
  ] satisfies [{ minutes: number; unit?: DurationUnit }, string][])("formats %j as %s", (data, formatted) => {
    expect(formatDelayDuration(data)).toBe(formatted);
  });

  it("uses the same seven-day ceiling in every displayed unit", () => {
    expect(MAX_DELAY_MINUTES).toBe(7 * 24 * 60);
    expect(durationToMinutes(604800, "seconds")).toBe(MAX_DELAY_MINUTES);
    expect(durationToMinutes(168, "hours")).toBe(MAX_DELAY_MINUTES);
    expect(durationFromMinutes(MAX_DELAY_MINUTES, "hours")).toBe(168);
  });
});

describe("persisted delay compatibility", () => {
  it.each(["seconds", "minutes", "hours"] as const)("preserves %s metadata alongside canonical minutes when parsed", (unit) => {
    const parsed = parseFlowDefinition(graphWithDelay({ minutes: 0.5, unit }));
    expect(parsed.nodes.find((node) => node.id === "resource")?.data).toEqual({ minutes: 0.5, unit });
  });

  it("keeps old delays valid without adding a stored display unit", () => {
    const parsed = parseFlowDefinition(graphWithDelay({ minutes: 60 }));
    expect(parsed.nodes.find((node) => node.id === "resource")?.data).toEqual({ minutes: 60 });
  });

  it("preserves an absolute date and its existing duration metadata", () => {
    const data = { minutes: 120, unit: "hours", until: "2026-10-10T12:00:00-03:00" };
    const parsed = parseFlowDefinition(graphWithDelay(data));
    expect(parsed.nodes.find((node) => node.id === "resource")?.data).toEqual(data);
  });

  it.each([0, MAX_DELAY_MINUTES])("accepts the canonical boundary %s minutes", (minutes) => {
    expect(() => parseFlowDefinition(graphWithDelay({ minutes, unit: "minutes" }))).not.toThrow();
  });

  it.each([-0.01, MAX_DELAY_MINUTES + 0.01, Infinity, NaN])("rejects an invalid canonical duration %s", (minutes) => {
    expect(() => parseFlowDefinition(graphWithDelay({ minutes, unit: "seconds" }))).toThrow();
  });

  it("rejects a display unit outside the supported choices", () => {
    expect(() => parseFlowDefinition(graphWithDelay({ minutes: 60, unit: "days" }))).toThrow();
  });
});
