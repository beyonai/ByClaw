import { describe, expect, it } from "vitest";
import {
  humanTaskItems,
  requireReview,
  requireSubmission,
  taskId,
} from "../src/domain/human-task.js";
describe("human task rules", () => {
  it("keeps bigint identifiers as strings", () => {
    expect(taskId({ id: "8000000000000000001" }, "id")).toBe("8000000000000000001");
    expect(() => taskId({ id: 8000000000000000001 }, "id")).toThrow();
  });
  it("accepts incomplete drafts but requires complete confirmed items", () => {
    expect(humanTaskItems([{}], false)[0].title).toBe("");
    expect(() => humanTaskItems([{}], true)).toThrow("ITEM_INCOMPLETE");
  });
  it("does not allow duplicate item keys", () => {
    expect(() => humanTaskItems([{ itemKey: "a" }, { itemKey: "a" }], false)).toThrow();
  });
  it("requires content and freezes accepted tasks", () => {
    expect(() => requireSubmission({ status: "PENDING" }, { text: " ", files: [] })).toThrow();
    expect(() => requireSubmission({ status: "ACCEPTED" }, { text: "result" })).toThrow();
    expect(() =>
      requireSubmission({ status: "PENDING_REVIEW" }, { files: [{ filePath: "/result" }] }),
    ).not.toThrow();
  });
  it("rejects stale acceptance and requires return opinion", () => {
    const task = { status: "PENDING_REVIEW", latestSubmissionId: "12", revision: 2 };
    expect(() =>
      requireReview(task, { submissionId: "11", expectedRevision: 2, decision: "ACCEPT" }),
    ).toThrow("STALE_VERSION");
    expect(() =>
      requireReview(task, { submissionId: "12", expectedRevision: 2, decision: "RETURN" }),
    ).toThrow("OPINION_REQUIRED");
    expect(() =>
      requireReview(task, { submissionId: "12", expectedRevision: 2, decision: "ACCEPT" }),
    ).not.toThrow();
  });
});
