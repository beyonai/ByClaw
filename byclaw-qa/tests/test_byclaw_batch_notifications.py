from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.events import parse_knowledge_event
from byclaw_knowledge_event_publisher import (
    ByClawKnowledgeEventPublisher,
    CALLBACK_CONTEXT_EXTRA_PARAM,
    _build_batch_notification,
    _resolve_batch_details_from_db,
)
from byclaw_userfs_storage import (
    USER_CODE_HEADER,
    CHAT_SESSION_ID_HEADER,
    set_byclaw_userfs_headers,
    reset_byclaw_userfs_headers,
)


def event(kind="discovery", succeeded=2, failed=0, skipped=0):
    return parse_knowledge_event({
        "eventId": "event-1", "eventType": f"semantic.{kind}.batch.completed",
        "eventVersion": 1, "knCode": "kb-1", "occurredAt": "2026-09-07T12:00:00Z",
        "payload": {
            "batchId": "batch-1", "knowledgeBaseId": "168",
            "taskType": "ENTITY_DISCOVERY" if kind == "discovery" else "DOCUMENT_ENRICH",
            "progress": {"version": 1, "totalCount": succeeded + failed + skipped,
                         "completedCount": succeeded + failed + skipped,
                         "succeededCount": succeeded, "failedCount": failed,
                         "skippedCount": skipped},
        },
    })


@pytest.mark.parametrize("kind", ["discovery", "enrich"])
def test_zero_batch_does_not_claim_success_or_invent_skip_reason(kind):
    content = _build_batch_notification(event(kind, succeeded=0), resource_id="42")
    assert "本次未新建处理任务" in content
    assert "已有任务复用及受理时跳过的明细不在批次清单中" in content
    assert "全部成功" not in content
    assert "来源会话 ID：未提供" in content


def test_preview_has_paths_reasons_truncation_and_only_crlf():
    files = [{"status": "failed", "file_path_snapshot": f"/Docs/{i}.pdf",
              "error_code": "TASK_TIMEOUT", "error_message": "超时\r\n" + "原因" * 100}
             for i in range(12)]
    content = _build_batch_notification(
        event(succeeded=2, failed=12), resource_id="42", chat_session_id="session-1",
        details={"kb_name": "研发知识库", "files": files},
    )
    assert "知识库：研发知识库（编码：kb-1）" in content
    assert "来源会话 ID：session-1" in content
    assert "文件清单（展示 10 / 14" in content
    assert content.count("• [失败]") == 10
    assert "另有 4 个文件未展示" in content
    assert "/Docs/10.pdf" not in content
    assert "（TASK_TIMEOUT）" in content
    assert "…" in content
    assert "\n" not in content.replace("\r\n", "")
    assert "\r" not in content.replace("\r\n", "")


async def test_detail_query_is_batch_scoped_bounded_and_failure_first():
    connection = MagicMock(close=AsyncMock())
    failed = [{"status": "failed", "file_path_snapshot": "/bad.pdf"}]
    skipped = [{"status": "skipped", "file_path_snapshot": "/skip.pdf"}]
    succeeded = [{"status": "succeeded", "file_path_snapshot": f"/{i}.pdf"} for i in range(8)]
    query = AsyncMock(side_effect=[(1, failed), (1, skipped), (10, succeeded)])
    with (
        patch("byclaw_knowledge_event_publisher.build_connection_factory",
              return_value=AsyncMock(return_value=connection)),
        patch("byclaw_knowledge_event_publisher.KnowledgeBaseRepository.get_by_code",
              new=AsyncMock(return_value={"kid": 168, "kb_name": "研发知识库"})),
        patch("byclaw_knowledge_event_publisher.ProcessingTaskQueryRepository.query", new=query),
    ):
        details = await _resolve_batch_details_from_db(event(succeeded=10, failed=1, skipped=1))
    assert details["files"] == failed + skipped + succeeded
    calls = [call.kwargs for call in query.await_args_list]
    assert [call["statuses"] for call in calls] == [["failed"], ["skipped", "unsupported"], ["succeeded"]]
    assert [call["limit"] for call in calls] == [10, 9, 8]
    for call in calls:
        assert call["knowledge_base_id"] == 168
        assert call["batch_id"] == "batch-1"
        assert call["task_type"] == "ENTITY_DISCOVERY"
        assert call["latest_only"] is False
        assert call["offset"] == 0
    connection.close.assert_awaited_once()


async def test_empty_batch_only_queries_kb_metadata():
    connection = MagicMock(close=AsyncMock())
    query = AsyncMock()
    with (
        patch("byclaw_knowledge_event_publisher.build_connection_factory",
              return_value=AsyncMock(return_value=connection)),
        patch("byclaw_knowledge_event_publisher.KnowledgeBaseRepository.get_by_code",
              new=AsyncMock(return_value={"kid": 168, "kb_name": "研发知识库"})),
        patch("byclaw_knowledge_event_publisher.ProcessingTaskQueryRepository.query", new=query),
    ):
        assert await _resolve_batch_details_from_db(event(succeeded=0)) == {
            "kb_name": "研发知识库", "files": [],
        }
    query.assert_not_called()
    connection.close.assert_awaited_once()


@pytest.mark.parametrize("error", [RuntimeError("database unavailable"), TimeoutError()])
async def test_detail_failure_still_sends_terminal_notification(error):
    send = AsyncMock(return_value={"resultCode": "0"})
    publisher = ByClawKnowledgeEventPublisher(
        get_json=send, user_id_resolver=lambda _: "77", beyond_token_resolver=lambda _: "token",
        batch_details_resolver=AsyncMock(side_effect=error),
        batch_context_resolver=lambda *_: {CALLBACK_CONTEXT_EXTRA_PARAM: {
            "userCode": "user-1", "chatSessionId": "session-1", "resourceId": "42",
        }},
    )
    await publisher.publish(event())
    content = send.await_args.args[1]["content"]
    assert "文件详情暂不可用" in content
    assert "来源会话 ID：session-1" in content
    assert "成功 2" in content


async def test_semantic_batch_uses_persisted_session_over_ambient_request():
    publisher = ByClawKnowledgeEventPublisher(
        batch_context_resolver=lambda *_: {CALLBACK_CONTEXT_EXTRA_PARAM: {
            "userCode": "original-user", "chatSessionId": "original-session",
        }},
    )
    token = set_byclaw_userfs_headers({USER_CODE_HEADER: "new-user", CHAT_SESSION_ID_HEADER: "new-session"})
    try:
        context = await publisher._resolve_context(event())
    finally:
        reset_byclaw_userfs_headers(token)
    assert context.user_code == "original-user"
    assert context.chat_session_id == "original-session"


@pytest.mark.parametrize("kind", ["discovery", "enrich", "build"])
async def test_all_zero_batch_skips_context_details_and_delivery(kind):
    from by_qa.knowledge_base.events import build_file_build_batch_terminal_event

    empty = event(kind if kind != "build" else "discovery", succeeded=0)
    if kind == "build":
        empty = build_file_build_batch_terminal_event({
            "batch_id": "batch-1", "kb_code": "kb-1", "knowledge_base_id": 168,
            "scope": "DIRECTORY", "target_path_snapshot": "/",
            "candidate_count": 0, "eligible_count": 0, "accepted_count": 0,
            "reused_count": 0, "acceptance_skipped_count": 0, "completed_count": 0,
        }, {})
    context = MagicMock(side_effect=AssertionError("context must not be queried"))
    details = MagicMock()
    send = AsyncMock()
    token = MagicMock()
    publisher = ByClawKnowledgeEventPublisher(
        get_json=send, batch_context_resolver=context,
        build_batch_context_resolver=context, batch_details_resolver=details,
        beyond_token_resolver=token,
    )
    await publisher.publish(empty)
    context.assert_not_called()
    details.assert_not_called()
    token.assert_not_called()
    send.assert_not_called()


@pytest.mark.parametrize("reused", [True, False])
async def test_build_with_only_reuse_or_acceptance_skips_still_notifies(reused):
    from by_qa.knowledge_base.events import build_file_build_batch_terminal_event

    completed = build_file_build_batch_terminal_event({
        "batch_id": "batch-1", "kb_code": "kb-1", "knowledge_base_id": 168,
        "scope": "DIRECTORY", "target_path_snapshot": "/",
        "candidate_count": 1, "eligible_count": int(reused), "accepted_count": 0,
        "reused_count": int(reused), "acceptance_skipped_count": int(not reused),
        "completed_count": 0,
    }, {})
    send = AsyncMock(return_value={"resultCode": "0"})
    publisher = ByClawKnowledgeEventPublisher(
        get_json=send, user_id_resolver=lambda _: "77", beyond_token_resolver=lambda _: "token",
        build_batch_context_resolver=lambda *_: {
            CALLBACK_CONTEXT_EXTRA_PARAM: {"userCode": "user-1"},
        },
        batch_details_resolver=lambda _: {"kb_name": "知识库", "files": []},
    )
    await publisher.publish(completed)
    send.assert_awaited_once()
    assert "本次未新建处理任务" in send.await_args.args[1]["content"]


@pytest.mark.parametrize("status", ["succeeded", "failed", "skipped", "unsupported"])
@pytest.mark.parametrize("scope", ["SINGLE_FILE", "DIRECTORY"])
async def test_build_message_suppression_depends_on_scope_not_file_count(scope, status):
    from by_qa.knowledge_base.events import build_file_build_batch_terminal_event

    completed = build_file_build_batch_terminal_event({
        "batch_id": "batch-1", "kb_code": "kb-1", "knowledge_base_id": 168,
        "scope": scope, "target_path_snapshot": "/a.pdf" if scope == "SINGLE_FILE" else "/",
        "candidate_count": 1, "eligible_count": 1, "accepted_count": 1,
        "reused_count": 0, "acceptance_skipped_count": 0, "completed_count": 1,
    }, {status: 1})
    send = AsyncMock(return_value={"resultCode": "0"})
    context = MagicMock(return_value={
        CALLBACK_CONTEXT_EXTRA_PARAM: {"userCode": "user-1"},
    })
    details = MagicMock(return_value={"kb_name": "知识库", "files": []})
    token = MagicMock(return_value="token")
    publisher = ByClawKnowledgeEventPublisher(
        get_json=send, user_id_resolver=lambda _: "77", beyond_token_resolver=token,
        build_batch_context_resolver=context, batch_details_resolver=details,
    )
    await publisher.publish(completed)
    if scope == "SINGLE_FILE":
        send.assert_not_called()
        context.assert_not_called()
        details.assert_not_called()
        token.assert_not_called()
    else:
        send.assert_awaited_once()
