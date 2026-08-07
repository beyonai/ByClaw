import { describe, expect, it } from "vitest";
import { adaptVolcengineArkResponsesPayload } from "../src/pi-provider-adapters/volcengine-ark.js";

describe("Volcengine Ark Responses compatibility", () => {
  it("maps OpenAI reasoning parameters to enabled Ark thinking", () => {
    expect(
      adaptVolcengineArkResponsesPayload({
        model: "deepseek-v4-pro-260425",
        reasoning: { effort: "high", summary: "auto" },
        include: ["reasoning.encrypted_content", "file_search_call.results"],
      }),
    ).toEqual({
      model: "deepseek-v4-pro-260425",
      thinking: { type: "enabled" },
      include: ["file_search_call.results"],
    });
  });

  it("maps the Pi off level to disabled Ark thinking", () => {
    expect(
      adaptVolcengineArkResponsesPayload({
        input: [],
        reasoning: { effort: "none" },
        include: ["reasoning.encrypted_content"],
      }),
    ).toEqual({
      input: [],
      thinking: { type: "disabled" },
    });
  });

  it("leaves payloads without OpenAI reasoning parameters unchanged", () => {
    const payload = {
      input: [],
      thinking: { type: "enabled" },
    };

    expect(adaptVolcengineArkResponsesPayload(payload)).toBe(payload);
  });
});
