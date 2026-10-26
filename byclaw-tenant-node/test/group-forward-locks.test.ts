import { expect, it } from "vitest";
import { lockSessions } from "../src/infrastructure/persistence/session-locks.js";
it("oppositeDirectionsAcquireSameNumericOrderWithoutNumberCoercion", async () => {
  const calls: string[][] = [];
  for (const ids of [
    ["9007199254741001", "20", "3", "20"],
    ["3", "20", "9007199254741001"],
  ]) {
    const keys: string[] = [];
    await lockSessions(
      {
        query: async () => {
          throw new Error("locking must not query the database");
        },
        lock: async (key) => {
          keys.push(key);
        },
      },
      ids,
    );
    calls.push(keys);
  }
  expect(calls).toEqual([
    ["session:3", "session:20", "session:9007199254741001"],
    ["session:3", "session:20", "session:9007199254741001"],
  ]);
});
