import { describe, expect, it } from "vitest";
import {
  ASK_USER_QUESTION_ENABLED,
  DOWNLOAD_ATTACHMENT_ENABLED,
  LEADER_CHECKPOINT_TOOL_NAMES,
  LEADER_FILE_TOOL_NAMES,
  resolveActiveLeaderToolNames,
} from "../src/context/active-leader-tools.js";

describe("Leader checkpoint tool allowlist", () => {
  it("covers attachment tools and every enabled session file tool", () => {
    expect(ASK_USER_QUESTION_ENABLED).toBe(true);
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("askUserQuestion");
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("inspectAttachment");
    // downloadAttachment 随 DOWNLOAD_ATTACHMENT_ENABLED 开关进出长期 checkpoint 白名单。
    if (DOWNLOAD_ATTACHMENT_ENABLED) {
      expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("downloadAttachment");
    } else {
      expect(LEADER_CHECKPOINT_TOOL_NAMES).not.toContain("downloadAttachment");
    }
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toEqual(
      expect.arrayContaining([...LEADER_FILE_TOOL_NAMES]),
    );
  });
});

describe("active Leader tools", () => {
  const specialist = {
    id: "agent-1",
    name: "专家",
    execution: { connectorId: "connector", targetId: "agent-1" },
  };

  it("keeps the existing attachment inspection tool for Super Assistant", () => {
    expect(
      resolveActiveLeaderToolNames({
        authorizedAgents: [specialist],
        hasAttachments: true,
        inspectAttachmentAvailable: true,
        downloadAttachmentAvailable: false,
        expertTeam: false,
      }),
    ).toEqual(expect.arrayContaining(["delegateAgent", "inspectAttachment"]));
  });

  it("exposes delegation and structured clarification to an expert-team leader", () => {
    expect(
      resolveActiveLeaderToolNames({
        authorizedAgents: [specialist],
        hasAttachments: true,
        inspectAttachmentAvailable: true,
        downloadAttachmentAvailable: true,
        expertTeam: true,
      }),
    ).toEqual(["delegateAgent", "askUserQuestion"]);
  });

  it("isolates execution, checkpoint, and finalization tool sets", () => {
    const base = {
      authorizedAgents: [specialist],
      hasAttachments: false,
      inspectAttachmentAvailable: false,
      downloadAttachmentAvailable: false,
      expertTeam: true,
      taskPlanAvailable: true,
    } as const;

    expect(
      resolveActiveLeaderToolNames({ ...base, executionPhase: "execute_step" }),
    ).toEqual(["delegateAgent", "askUserQuestion"]);
    expect(
      resolveActiveLeaderToolNames({ ...base, executionPhase: "checkpoint" }),
    ).toEqual(["updateTaskPlan"]);
    expect(
      resolveActiveLeaderToolNames({ ...base, executionPhase: "finalize" }),
    ).toEqual([]);
    expect(
      resolveActiveLeaderToolNames({ ...base, executionPhase: "react" }),
    ).toEqual(["delegateAgent", "askUserQuestion", "updateTaskPlan"]);
  });
});
