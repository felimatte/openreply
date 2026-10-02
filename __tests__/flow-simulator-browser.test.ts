import { afterEach, expect, it, vi } from "vitest";
import { createTemplate } from "@/components/flows/model";
import { respondSimulation, startSimulation } from "@/lib/flows/simulator";

afterEach(() => vi.unstubAllGlobals());

it("runs the browser preview without the Node Buffer global", () => {
  // The shared runtime also exports server button serialization helpers. The
  // browser's simulator paths must never call those helpers or require Buffer.
  vi.stubGlobal("Buffer", undefined);
  const graph = createTemplate("lead");
  const opening = startSimulation(graph);
  expect(opening.windowMinutesRemaining).toBeNull();
  const question = respondSimulation(graph, opening, { text: "SI" });
  expect(question.waiting).toBe("input");
  const answered = respondSimulation(graph, question, { text: "Mi email es ANA@example.com" });
  expect(answered.fields.email).toBe("ana@example.com");
  expect(answered.tags).toContain("Lead de Reel");
  expect(answered.finished).toBe(true);
});
