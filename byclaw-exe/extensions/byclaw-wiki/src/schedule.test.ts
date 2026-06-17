import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRunWeeklySchedule } from "./schedule.js";

describe("shouldRunWeeklySchedule", () => {
  it("matches Saturday 03:00 in Asia/Shanghai once per minute key", () => {
    const now = new Date("2026-06-19T19:00:12.000Z");

    const first = shouldRunWeeklySchedule({
      now,
      timezone: "Asia/Shanghai",
      dayOfWeek: 6,
      hour: 3,
      minute: 0,
    });
    const second = shouldRunWeeklySchedule({
      now,
      timezone: "Asia/Shanghai",
      dayOfWeek: 6,
      hour: 3,
      minute: 0,
      lastRunKey: first.key,
    });

    assert.equal(first.run, true);
    assert.equal(second.run, false);
  });

  it("does not match a different minute", () => {
    const decision = shouldRunWeeklySchedule({
      now: new Date("2026-06-19T19:01:00.000Z"),
      timezone: "Asia/Shanghai",
      dayOfWeek: 6,
      hour: 3,
      minute: 0,
    });

    assert.equal(decision.run, false);
  });
});
