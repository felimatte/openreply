import { parseAnswer } from "@/lib/contacts/answers";

export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export function messagingWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()) {
  if (!lastInboundAt) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < MESSAGING_WINDOW_MS;
}

export function incomingEventTime(timestamp?: number, now = Date.now()) {
  if (!timestamp || !Number.isFinite(timestamp)) return now;
  // Some providers use seconds; Meta messaging webhooks use milliseconds.
  const value = timestamp < 100_000_000_000 ? timestamp * 1_000 : timestamp;
  return Math.min(value, now);
}

export function renderFlowText(text: string, values: Record<string, unknown>) {
  return text.replace(/\{\{?([a-zA-Z0-9_.:-]+)(?:\|([^}]*))?\}\}?/g, (_all, key: string, fallback?: string) => {
    const value = values[key];
    return value === undefined || value === null || value === "" ? fallback ?? "" : String(value);
  });
}

export type AnswerResult = { ok: true; value: string } | { ok: false };
export function parseFlowAnswer(type: string, text: string, choices: readonly { label: string; value?: string }[] = []): AnswerResult {
  if (type === "number" || type === "NUMBER") {
    const value = text.trim().replace(",", ".");
    return /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? { ok: true, value } : { ok: false };
  }
  if (type === "choice" || type === "CHOICE") {
    const choice = choices.find((item) => [item.label, item.value].some((value) => value?.trim().toLowerCase() === text.trim().toLowerCase()));
    return choice ? { ok: true, value: choice.value ?? choice.label } : { ok: false };
  }
  return parseAnswer(type.toUpperCase() === "EMAIL" ? "EMAIL" : type.toUpperCase() === "PHONE" ? "PHONE" : "TEXT", text);
}

export type ButtonReference = { runId: string; nodeId: string; visit: number; buttonId: string };
export function flowButtonPayload(reference: ButtonReference) {
  return `flow.${Buffer.from(JSON.stringify(reference)).toString("base64url")}`;
}
export function parseFlowButtonPayload(payload: string): ButtonReference | null {
  if (!payload.startsWith("flow.") || payload.length > 1_000) return null;
  try {
    const value = JSON.parse(Buffer.from(payload.slice(5), "base64url").toString("utf8"));
    if (!value || typeof value.runId !== "string" || typeof value.nodeId !== "string" || typeof value.buttonId !== "string" || !Number.isSafeInteger(value.visit) || value.visit < 0) return null;
    return value;
  } catch { return null; }
}

export function compareFlowValue(actual: unknown, operator: string, expected?: string) {
  const text = actual === undefined || actual === null ? "" : String(actual);
  if (operator === "exists") return actual !== undefined && actual !== null && text !== "";
  if (operator === "not_exists" || operator === "is_empty") return actual === undefined || actual === null || text === "";
  if (operator === "contains") return text.toLowerCase().includes((expected ?? "").toLowerCase());
  if (operator === "not_contains") return !text.toLowerCase().includes((expected ?? "").toLowerCase());
  if (operator === "gt" || operator === "greater_than") return text !== "" && Number.isFinite(Number(text)) && Number(text) > Number(expected);
  if (operator === "lt" || operator === "less_than") return text !== "" && Number.isFinite(Number(text)) && Number(text) < Number(expected);
  if (operator === "neq" || operator === "not_equals") return text.toLowerCase() !== (expected ?? "").toLowerCase();
  return actual !== undefined && actual !== null && text.toLowerCase() === (expected ?? "").toLowerCase();
}

export function weightedBranch(branches: readonly { id: string; weight: number }[], sample: number) {
  const total = branches.reduce((sum, branch) => sum + Math.max(0, branch.weight), 0);
  if (!total) throw new Error("A randomizer needs a positive weight");
  let remaining = Math.max(0, Math.min(sample, 1 - Number.EPSILON)) * total;
  for (const branch of branches) {
    remaining -= Math.max(0, branch.weight);
    if (remaining < 0) return branch.id;
  }
  return branches[branches.length - 1].id;
}
