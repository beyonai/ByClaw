import { describe, expect, it } from "vitest";
import { parseBusinessTerminology, replaceBusinessTerminology } from "./business-terminology.js";

describe("business terminology", () => {
  it("parses the system-config Redis payload and replaces prompt terms", () => {
    const terminology = parseBusinessTerminology({
      paramValue: JSON.stringify({
        "zh-CN": { singular: "专家", plural: "专家", entry: "专家", market: "专家市场" },
        "en-US": {
          singular: "Expert",
          plural: "Experts",
          entry: "Experts",
          market: "Expert Marketplace",
        },
      }),
    });

    expect(
      replaceBusinessTerminology(
        "你是专业数字员工。Digital Employees include each Digital Employee. Create a Digital Employee.",
        terminology,
      ),
    ).toBe("你是专业专家。Experts include each Expert. Create an Expert.");
  });

  it("preserves defaults for invalid config", () => {
    const terminology = parseBusinessTerminology("invalid-json");
    expect(replaceBusinessTerminology("数字员工 / Digital Employee", terminology)).toBe(
      "数字员工 / Digital Employee",
    );
  });
});
