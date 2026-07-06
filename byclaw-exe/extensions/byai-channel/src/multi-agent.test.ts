import { describe, expect, it } from "vitest";
import {
  appendByaiLaneToSessionKey,
  appendByaiLaneToTarget,
  buildByaiMultiAgentLaneMessages,
  parseByaiLaneMetadata,
  parseByaiMultiAgentBatchMetadata,
} from "./multi-agent.js";
import type { ByaiSdkInboundMessage } from "./types.js";

describe("multi-agent lane metadata", () => {
  it("parses gateway extraPayload.multi_agent", () => {
    expect(
      parseByaiLaneMetadata({
        multi_agent: {
          turnId: "turn-1",
          laneId: "lane-a",
          mode: "parallel",
          traceId: "trace-a",
          agentId: 42,
          agentCode: "agent-code",
          agentName: "Agent A",
          clientRequestId: "client-1",
          answerMessageId: "answer-1",
          queryMessageId: "query-1",
        },
      }),
    ).toEqual({
      turnId: "turn-1",
      laneId: "lane-a",
      mode: "parallel",
      traceId: "trace-a",
      agentId: "42",
      agentCode: "agent-code",
      agentName: "Agent A",
      clientRequestId: "client-1",
      answerMessageId: "answer-1",
      queryMessageId: "query-1",
    });
  });

  it("parses gateway extraPayload.multiAgent and snake-case aliases", () => {
    expect(
      parseByaiLaneMetadata({
        multiAgent: JSON.stringify({
          turn_id: "turn-2",
          lane_id: "lane-b",
          client_request_id: "client-2",
          answer_message_id: "answer-2",
          query_message_id: "query-2",
          agent_id: "agent-b",
          agent_name: "Agent B",
        }),
      }),
    ).toMatchObject({
      turnId: "turn-2",
      laneId: "lane-b",
      clientRequestId: "client-2",
      answerMessageId: "answer-2",
      queryMessageId: "query-2",
      agentId: "agent-b",
      agentName: "Agent B",
    });
  });

  it("keeps single-agent payloads unchanged", () => {
    expect(parseByaiLaneMetadata({ agent_id: "agent-a" })).toBeUndefined();
    expect(
      parseByaiLaneMetadata({
        multi_agent: { turnId: "turn-1", mode: "parallel", lanes: [] },
      }),
    ).toBeUndefined();
    expect(appendByaiLaneToSessionKey("agent:a:direct:s1", undefined)).toBe(
      "agent:a:direct:s1",
    );
    expect(appendByaiLaneToTarget("agent-a:s1", undefined)).toBe("agent-a:s1");
  });

  it("appends an encoded lane key to session and target keys", () => {
    const laneMetadata = { laneId: "lane/a b" };
    expect(appendByaiLaneToSessionKey("agent:a:direct:s1", laneMetadata)).toBe(
      "agent:a:direct:s1:lane:lane%2Fa%20b",
    );
    expect(appendByaiLaneToTarget("agent-a:s1", laneMetadata)).toBe(
      "agent-a:s1:lane:lane%2Fa%20b",
    );
  });

  it("parses batch lanes and builds per-lane inbound messages", () => {
    const batch = parseByaiMultiAgentBatchMetadata({
      multi_agent: {
        turnId: "turn-3",
        mode: "parallel",
        lanes: [
          {
            laneId: "coder",
            traceId: "trace-coder",
            agentId: "100",
            agentCode: "CODER",
            agentName: "Coder",
            answerMessageId: "answer-coder",
            queryMessageId: "query-1",
          },
          {
            laneId: "reviewer",
            traceId: "trace-reviewer",
            agentId: "200",
            agentCode: "REVIEWER",
            agentName: "Reviewer",
            answerMessageId: "answer-reviewer",
            queryMessageId: "query-1",
          },
        ],
      },
    });

    expect(batch).toMatchObject({
      turnId: "turn-3",
      mode: "parallel",
      lanes: [
        {
          turnId: "turn-3",
          mode: "parallel",
          laneId: "coder",
          traceId: "trace-coder",
          agentId: "100",
        },
        {
          turnId: "turn-3",
          mode: "parallel",
          laneId: "reviewer",
          traceId: "trace-reviewer",
          agentId: "200",
        },
      ],
    });

    const base: ByaiSdkInboundMessage = {
      messageId: "base-answer",
      sessionId: "session-1",
      userId: "user-1",
      text: "自然派活",
      timestamp: 1,
      traceId: "base-trace",
      accountId: "default",
      language: "zh_CN",
      languageProvided: false,
      extraPayload: { multi_agent: { ignored: true } },
    };

    const messages = buildByaiMultiAgentLaneMessages(base, batch);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.traceId)).toEqual([
      "trace-coder",
      "trace-reviewer",
    ]);
    expect(messages.map((message) => message.messageId)).toEqual([
      "answer-coder",
      "answer-reviewer",
    ]);
    expect(messages[0].extraPayload).toMatchObject({
      agent_id: "100",
      agent_code: "CODER",
      agent_name: "Coder",
      multi_agent: {
        laneId: "coder",
        traceId: "trace-coder",
      },
    });
  });
});
