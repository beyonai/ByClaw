import { describe, expect, it } from "vitest";
import { adaptByclawMessageRoles } from "../src/pi-provider-adapters/byclaw-message-roles.js";

describe("byclaw-super provider message roles", () => {
  it("rewrites developer to system in Responses input", () => {
    expect(
      adaptByclawMessageRoles({
        model: "reasoning-model",
        input: [
          { role: "developer", content: "system instructions" },
          { role: "user", content: "question" },
        ],
      }),
    ).toEqual({
      model: "reasoning-model",
      input: [
        { role: "system", content: "system instructions" },
        { role: "user", content: "question" },
      ],
    });
  });

  it("rewrites developer to system in Chat Completions messages", () => {
    expect(
      adaptByclawMessageRoles({
        messages: [
          { role: "developer", content: "system instructions" },
          { role: "assistant", content: "answer" },
        ],
      }),
    ).toEqual({
      messages: [
        { role: "system", content: "system instructions" },
        { role: "assistant", content: "answer" },
      ],
    });
  });

  it("preserves payload identity when no unsupported role is present", () => {
    const payload = {
      input: [{ role: "system", content: "system instructions" }],
    };

    expect(adaptByclawMessageRoles(payload)).toBe(payload);
  });
});
