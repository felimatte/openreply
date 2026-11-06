import { describe, expect, it } from "vitest";
import { resolveMusaFlowBundle, type MusaFlowSource } from "@/lib/integrations/musa/flow-bundle";
import { flowSource } from "./fixtures/musa-flow-source";

const resolve = (sources: MusaFlowSource[]) => resolveMusaFlowBundle(sources[0], new Map(sources.map(source => [source.automation.id, source])));
describe("frozen MUSA transitive flow bundle", () => {
  it("accepts paused published sources and deduplicates a shared dependency", () => {
    const result = resolve([flowSource("root", ["a", "b"]), flowSource("a", ["shared"]), flowSource("b", ["shared"]), flowSource("shared")]);
    expect(result.reason).toBeNull(); expect(result.sources).toHaveLength(4);
  });
  it("rejects direct and indirect cycles without following them forever", () => {
    expect(resolve([flowSource("a", ["a"])]).reason).toBe("FLOW_CHAIN_CYCLE");
    expect(resolve([flowSource("a", ["b"]), flowSource("b", ["a"])]).reason).toBe("FLOW_CHAIN_CYCLE");
  });
  it("accepts the engine's five links and rejects a sixth", () => {
    const chain = Array.from({ length: 7 }, (_, i) => flowSource(`node${i}`, i === 6 ? [] : [`node${i + 1}`]));
    expect(resolve(chain).reason).toBe("FLOW_CHAIN_DEPTH_LIMIT");
    expect(resolve(chain.slice(1)).reason).toBeNull();
  });
  it("does not hide a too-deep diamond behind a previous short path cache", () => {
    const sources = [flowSource("root", ["shared", "a"]), flowSource("a", ["b"]), flowSource("b", ["c"]),
      flowSource("c", ["shared"]), flowSource("shared", ["last"]), flowSource("last", ["end"]), flowSource("end")];
    expect(resolve(sources).reason).toBe("FLOW_CHAIN_DEPTH_LIMIT");
  });
  it("bounds independent dependencies and refuses missing/unpublished ones", () => {
    const children = Array.from({ length: 25 }, (_, i) => flowSource(`child${i}`));
    expect(resolve([flowSource("root", children.map(source => source.automation.id)), ...children]).reason).toBe("FLOW_CHAIN_SIZE_LIMIT");
    expect(resolve([flowSource("root", ["foreign"])]).reason).toBe("FLOW_DEPENDENCY_CHANGED");
    expect(resolve([flowSource("root", ["child"]), flowSource("child", [], { flowPublishedVersionId: null })]).reason).toBe("FLOW_VERSION_CHANGED");
  });
});
