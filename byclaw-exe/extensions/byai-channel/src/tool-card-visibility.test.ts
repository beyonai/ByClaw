import { describe, expect, it } from "vitest";
import { shouldEmitToolCard } from "./tool-card-visibility.js";

describe("shouldEmitToolCard", () => {
  it("hides updateTaskPlan regardless of tool-name casing", () => {
    expect(shouldEmitToolCard("updateTaskPlan")).toBe(false);
    expect(shouldEmitToolCard("updatetaskplan")).toBe(false);
    expect(shouldEmitToolCard("  UPDATETASKPLAN  ")).toBe(false);
  });

  it("keeps other tool cards visible", () => {
    expect(shouldEmitToolCard("baiying_call")).toBe(true);
    expect(shouldEmitToolCard("sessions_spawn")).toBe(true);
    expect(shouldEmitToolCard(undefined)).toBe(true);
  });
});
