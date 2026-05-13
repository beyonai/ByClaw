import { describe, expect, it } from "vitest";
import { parseCorePersonaDefinition } from "./core-persona-definition.js";

describe("parseCorePersonaDefinition", () => {
  it("returns narrative for plain text", () => {
    const r = parseCorePersonaDefinition("你是专家。");
    expect(r.extensions).toEqual([]);
    expect(r.narrativeText).toBe("你是专家。");
  });

  it("returns narrative when JSON is not a non-empty object array", () => {
    expect(parseCorePersonaDefinition("[]").narrativeText).toBe("[]");
    expect(parseCorePersonaDefinition("[1,2]").narrativeText).toBe("[1,2]");
  });

  it("parses structured extension array", () => {
    const raw = JSON.stringify([
      { name: "拓展属性", key: "custom_1", value: "拓展属性" },
    ]);
    const r = parseCorePersonaDefinition(raw);
    expect(r.extensions).toHaveLength(1);
    expect(r.extensions[0]).toMatchObject({
      name: "拓展属性",
      key: "custom_1",
      value: "拓展属性",
    });
    expect(r.narrativeText).toBeUndefined();
  });

  it("drops items with empty name and value", () => {
    const raw = JSON.stringify([{ key: "k" }]);
    const r = parseCorePersonaDefinition(raw);
    expect(r.extensions).toEqual([]);
    expect(r.narrativeText).toBe(raw);
  });
});
