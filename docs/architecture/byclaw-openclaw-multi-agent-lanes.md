# ByClaw OpenClaw Multi-Agent Lanes

## Goal

Support one ByClaw conversation where a user mentions multiple OpenClaw-backed digital employees and receives independent streamed replies in the same chat room.

The business session remains a single ByClaw `sessionId`. Each mentioned agent runs in its own lane, with its own target agent, `traceId`, answer placeholder, and OpenClaw `sessionKey`.

## Request Contract

Single-agent requests keep the existing shape.

Multi-agent requests add lane metadata under `extParams.multiAgent` on the ByClaw chat request. Backend code may also accept `extParams.multi_agent` for compatibility.

```json
{
  "turnId": "turn-uuid",
  "mode": "parallel",
  "lanes": [
    {
      "laneId": "lane-uuid-a",
      "agentId": "10001",
      "agentCode": null,
      "agentName": "Agent A",
      "clientRequestId": "queryMsg_answerMsgA",
      "queryMessageId": "queryMsg",
      "answerMessageId": "answerMsgA",
      "order": 0
    }
  ]
}
```

For every lane dispatch to Gateway, the backend sends the lane target as the current payload target:

- `extraPayload.agent_id`
- `extraPayload.agent_code`
- `extraPayload.agent_name`
- `extraPayload.multi_agent.turnId`
- `extraPayload.multi_agent.laneId`
- `extraPayload.multi_agent.mode`
- `extraPayload.multi_agent.clientRequestId`
- `extraPayload.multi_agent.queryMessageId`
- `extraPayload.multi_agent.answerMessageId`

## Stream Contract

All stream events for a lane must preserve these routing fields either as top-level event data or as event metadata:

- `sessionId`
- `traceId`
- `clientRequestId`
- `turnId`
- `laneId`
- `agentId` or `agentCode`
- `agentName`

Frontend routing order is:

1. `clientRequestId`
2. `traceId`
3. `laneId`
4. `sessionId` only for legacy single-agent streams

In a multi-agent turn, `sessionId` alone must not select an active answer message.

## Context Contract

OpenClaw transcript isolation remains agent-scoped.

- Same ByClaw `sessionId` and different target agents produce different OpenClaw `sessionKey` values.
- Same target agent and same ByClaw `sessionId` are serialized by the existing byai-channel session dispatch gate.
- Cross-agent context is passed only as controlled lane metadata or handoff summary, not by merging full transcripts.

## Completion And Cancel

`appStreamResponse` completes only the matching lane. The whole multi-agent turn is complete only after all lanes finish or are canceled.

Cancel targets a single lane by `traceId` or `clientRequestId`. Session-wide cancel is an explicit group operation.
