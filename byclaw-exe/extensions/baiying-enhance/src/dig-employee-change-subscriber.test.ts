import { describe, expect, it } from "vitest";
import {
  hasDigEmployeePubSubRedisConfig,
  isStaleDigEmployeeChangedAt,
  mergeDigEmployeeChangeEvents,
  parseDigEmployeeChangeMessage,
  recordDigEmployeeChangedAt,
} from "./dig-employee-change-subscriber.js";

describe("hasDigEmployeePubSubRedisConfig", () => {
  it("does not require USER_CODE to subscribe", () => {
    expect(
      hasDigEmployeePubSubRedisConfig({
        host: "127.0.0.1",
        port: 6379,
        db: 0,
        channel: "byai:pub:dig_employee_change",
      }),
    ).toBe(true);
  });
});

describe("parseDigEmployeeChangeMessage", () => {
  it("parses valid payload", () => {
    const raw = JSON.stringify({
      eventType: "DIG_EMPLOYEE_UPDATED",
      resourceId: 1001,
      resourceBizType: "DIG_EMPLOYEE",
      changedAt: 1735689600000,
      source: "manager-api",
    });
    const r = parseDigEmployeeChangeMessage(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.eventType).toBe("DIG_EMPLOYEE_UPDATED");
      expect(r.event.resourceIdStr).toBe("1001");
      expect(r.event.changedAt).toBe(1735689600000);
    }
  });

  it("rejects invalid JSON", () => {
    const r = parseDigEmployeeChangeMessage("{");
    expect(r.ok).toBe(false);
  });

  it("rejects missing resourceId", () => {
    const r = parseDigEmployeeChangeMessage(JSON.stringify({ eventType: "DIG_EMPLOYEE_UPDATED" }));
    expect(r.ok).toBe(false);
  });
});

describe("isStaleDigEmployeeChangedAt", () => {
  it("returns false when changedAt is missing", () => {
    const m = new Map<string, number>([["1", 100]]);
    expect(
      isStaleDigEmployeeChangedAt({ eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1" }, m),
    ).toBe(false);
  });

  it("returns true when changedAt is older than last applied", () => {
    const m = new Map<string, number>([["1", 100]]);
    expect(
      isStaleDigEmployeeChangedAt(
        { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1", changedAt: 50 },
        m,
      ),
    ).toBe(true);
  });

  it("recordDigEmployeeChangedAt stores max-applied cursor", () => {
    const m = new Map<string, number>();
    recordDigEmployeeChangedAt(
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 200 },
      m,
    );
    expect(m.get("2")).toBe(200);
  });
});

describe("mergeDigEmployeeChangeEvents", () => {
  it("prefers DELETE over UPDATE for same resourceId", () => {
    const m = mergeDigEmployeeChangeEvents([
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1", changedAt: 100 },
      { eventType: "DIG_EMPLOYEE_DELETED", resourceIdStr: "1", changedAt: 99 },
    ]);
    expect(m.get("1")?.eventType).toBe("DIG_EMPLOYEE_DELETED");
  });

  it("keeps newer changedAt when both non-delete", () => {
    const m = mergeDigEmployeeChangeEvents([
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 10 },
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 20 },
    ]);
    expect(m.get("2")?.changedAt).toBe(20);
  });
});
