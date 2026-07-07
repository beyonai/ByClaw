import { describe, expect, it } from "vitest";
import {
  appendByaiLaneToSessionKey,
  appendByaiLaneToTarget,
  buildByaiMultiAgentLaneMessages,
  parseByaiLaneMetadata,
  parseByaiMultiAgentBatchMetadata,
  resolveByaiLaneInboundTexts,
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
    expect(messages.map((message) => message.text)).toEqual([
      "自然派活",
      "自然派活",
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

  it("uses explicit lane task text when provided by gateway metadata", () => {
    const batch = parseByaiMultiAgentBatchMetadata({
      multi_agent: {
        lanes: [
          {
            laneId: "coder",
            agentName: "Coder",
            taskText: "只修复代码",
          },
          {
            laneId: "reviewer",
            agentName: "Reviewer",
            task_text: "只做 review",
          },
        ],
      },
    });
    expect(batch?.lanes.map((lane) => lane.taskText)).toEqual(["只修复代码", "只做 review"]);

    const messages = buildByaiMultiAgentLaneMessages({
      messageId: "base-answer",
      sessionId: "session-1",
      userId: "user-1",
      text: "@Coder修复 @Reviewer复核",
      timestamp: 1,
      traceId: "base-trace",
      accountId: "default",
      language: "zh_CN",
      languageProvided: false,
    }, batch);

    expect(messages.map((message) => message.text)).toEqual(["只修复代码", "只做 review"]);
  });

  it("isolates a compact inbound message by the mentioned lane agent", () => {
    const batch = parseByaiMultiAgentBatchMetadata({
      multi_agent: {
        turnId: "turn-mentions",
        mode: "parallel",
        lanes: [
          {
            laneId: "assistant",
            agentId: "1001",
            agentName: "陈舵主的个人助理",
          },
          {
            laneId: "issue-triage",
            agentId: "1002",
            agentName: "ByClaw issue-triage",
          },
        ],
      },
    });
    const baseText = "@陈舵主的个人助理帮我查询钉钉通讯录@ByClaw issue-triage我克隆https://github.com/beyonai/byclaw-test.git到/by/testCode目录下，帮我使用node 全局安装codegraph，然后去拉取issue列表，排优先级去列issue修复计划输出HTML";

    const messages = buildByaiMultiAgentLaneMessages({
      messageId: "base-answer",
      sessionId: "session-1",
      userId: "user-1",
      text: baseText,
      timestamp: 1,
      traceId: "base-trace",
      accountId: "default",
      language: "zh_CN",
      languageProvided: false,
    }, batch);

    expect(messages.map((message) => message.text)).toEqual([
      "帮我查询钉钉通讯录",
      "我克隆https://github.com/beyonai/byclaw-test.git到/by/testCode目录下，帮我使用node 全局安装codegraph，然后去拉取issue列表，排优先级去列issue修复计划输出HTML",
    ]);
    expect(messages[0].text).not.toContain("byclaw-test.git");
    expect(messages[1].text).not.toContain("钉钉通讯录");
  });

  it("does not expose another mentioned agent task to an unmatched lane", () => {
    const lanes = [
      {
        laneId: "coder",
        agentName: "Coder",
      },
      {
        laneId: "reviewer",
        agentName: "Reviewer",
      },
    ];

    const laneTexts = resolveByaiLaneInboundTexts("@Coder修复登录问题", lanes);

    expect(laneTexts.get(lanes[0])).toBe("修复登录问题");
    expect(laneTexts.get(lanes[1])).toContain("本轮 multi-agent 入站消息没有给 Reviewer 单独派发");
    expect(laneTexts.get(lanes[1])).not.toContain("修复登录问题");
  });
});
