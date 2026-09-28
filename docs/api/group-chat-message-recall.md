# Group chat message recall

## Recall

`POST /group-chats/{sessionId}/messages/{messageId}/recall`

No body is required. Authentication uses the current logged-in user. The caller must be a current group member. A member can recall their own user messages without a time limit; OWNER/ADMIN can recall any public user or Agent message. System messages (`usage=5`) cannot be recalled. An Agent-authored task result is not owned by the user who published it.

The endpoint uses the existing `ResponseUtil` wrapper. Its data is:

```json
{
  "sessionId": "100",
  "messageId": "200",
  "recalled": true,
  "recall": {
    "operatorId": "300",
    "operatorName": "张三",
    "recalledAt": 1790000000000
  },
  "content": "张三 撤回了一条消息"
}
```

Repeated authorized calls return the first successful recall identity and time without another message-state write or recall broadcast. They also wake any unfinished stop compensation. The operator name is resolved at read time from Redis `SHARE_BFM_USER_{operatorId}` using the existing shared-user cache; it is not stored with the message. Missing/failed cache reads fall back to `用户（ID）`. No user-table join or database fallback is performed.

## History and references

Existing group history, message position, topic list and topic message endpoints retain their paths, wrappers and pagination contracts. Message objects add `recalled` and nullable `recall`; reference objects add `recalled`.

For a recalled message, `content` contains the operator's recall notice and attachments/resource lists are empty. The original message ID, creation time, usage and relation identity remain intact. Clients must render `recalled=true` before checking message kind, using the system-event visual style at the original position. Do not insert a new item or convert usage to 5; hide normal body, attachment and task-card rendering.

For a normal message quoting a recalled source, retain `replyTo.messageId`, set `replyTo.recalled=true`, and show `replyTo.content="消息已撤回"`. The original quoted content is not returned. Search excludes recalled messages before keyword matching and pagination. A recalled message remains a valid position/pagination anchor and topic root.

The group list retains its latest message identity/time but replaces the preview and exposes `latestMessageRecalled`. Generic message details, paged history, share reads and conversation outlines also mask recalled content. Old clients receive safe text; the system-style presentation requires support for the new flag.

## WebSocket

After commit, online group members receive the same state fields as the response, plus:

```json
{
  "type": "GROUP_CHAT_EVENT",
  "event": "MESSAGE_RECALLED"
}
```

This is a state update, not `MESSAGE_CREATED`. It does not insert a system message, increment unread counts, reorder history or advance topic activity.

Update the message in place and invalidate all loaded references, topic previews, group summaries and search results for that message ID. Remember recall state even when the source has not loaded. Late creation/history payloads must never restore its old content. On reconnect, reload visible history and previews: fetching only IDs newer than the last message cannot discover recalls of older messages. Broadcast delivery is best effort; durable state is recovered by queries.

## Persistence and runtime boundary

Migration: `deploy/migrations/versions/V0.5.0/V0.5.0__ddl.sql` on branch `D0.5.0`, retaining nullable message columns `recalled_at` and `recalled_by` (added with `_v041_add_column_if_missing`), and adding `byai_group_chat_recall_stop` plus `byai_group_chat_send_gate`. No name column and no content backfill.

Original payload, references, topics, task records, files and read cursors remain stored. New group context reads and newly generated Agent history files mask recalled content. Frozen context files and private task history/results remain stored. Recall cannot retroactively erase already delivered information.

### Execution and task cancellation

- The recall transaction finds every turn triggered by this message and its automatic delegation descendants (`parent_turn_id`, or legacy `parent_execution_id`). Shared `root_message_id` and candidate session identity do not define cancellation scope: a later independent user follow-up is retained.
- Queued/running executions become `CANCELLED`. Completed executions retain their terminal status, with a separate durable recall barrier preventing future automatic delegation or delayed sends.
- Tasks are matched by `dispatch_id`. Matching `ACTIVE` tasks become `CANCELLED` even when waiting for input; their pending publication is cleared. `PUBLISHED` tasks keep their status and published results. Existing task status events are emitted after commit.
- After commit, running work receives the existing STOP_CHAT behavior, including plan cancellation. An active task's private continuation belongs to that task even when its trace differs from the initial group turn. A later independent group turn in the same session is not stopped.
- A successful recall response confirms durable recall/cancellation, not completion of the remote stop. A failed STOP response or exception leaves `PENDING` compensation. Recovery scans every 5 seconds by default (`byclaw.group-chat.recall-retry-ms`) and retries after process restart. Duplicate recalls also wake recovery.

### Send/stop concurrency

`ChatGatewaySendGuard` acquires an independent database row lock before runtime registration and releases it after the send phase, before waiting for streamed output. Pending stops are processed before another send can reuse the session. This lock uses a separate JDBC connection; it never suspends a transaction holding the group or task row lock during STOP callbacks.

Every actual Gateway send, including sandbox retries, checks the durable barrier. A recall committed before that check prevents the send. If recall races after the final check or while send is already in flight, the pending STOP runs after the sending scope releases; no later independent send can be caught by that compensation. This is compensation for an in-flight request, not a claim that an already-started network call can be undone.

Deploy all backend instances with this guard before enabling this behavior. Mixed old/new instances do not share the new send/stop coordination contract. The gate holds a separate database connection for the send/preparation phase; account for that connection in pool sizing. The implementation verifies negative Gateway cancellation responses as failures.

Deploy the schema before code. Disabling recall writes is safe; rolling back to a backend that ignores recall fields would expose retained content again. Frontend implementation and target-engine migration execution are separate deployment work.


## Branch integration verification (2026-09-28)

Implemented in the primary checkout `/Users/zhouhf/project/byai/ByClaw`, branch `D0.5.0`.
The branch's quoted-message context, attachment handling and ChatChainLog behavior are retained.
The final-turn cleanup now emits `ChatSessionReleased` after listener/owner cleanup, preserving group queue wakeup.

- `mvn -o -B -f byclaw-be/pom.xml verify`: BUILD SUCCESS; 3287 tests, zero failures/errors, 23 skipped.
- `git diff --check`: passed.
- Migration dry-run: version layout and DDL/DML placement passed. V0.5.0 remains pending; no initdb merge or `.applied` modification was performed.
- No live OpenGauss/Gateway end-to-end run and no commit were performed.
