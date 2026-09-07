from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.events import (
    build_file_build_batch_terminal_event,
    build_file_build_terminal_event,
)
from byclaw_knowledge_event_publisher import (
    CALLBACK_CONTEXT_EXTRA_PARAM,
    ByClawKnowledgeEventPublisher,
    _resolve_build_batch_context_from_db,
    _build_batch_notification,
)
from byclaw_knowledge_entity_runtime import (
    ByClawFileBuildBackgroundRunner,
    ByClawKnowledgeBuildAcceptanceRepository,
    install_byclaw_knowledge_entity_runtime,
)
from byclaw_userfs_storage import (
    USER_CODE_HEADER, CHAT_SESSION_ID_HEADER, RESOURCE_ID_HEADER,
    get_byclaw_userfs_header_context, set_byclaw_userfs_headers,
    reset_byclaw_userfs_headers,
)

CONTEXT = {CALLBACK_CONTEXT_EXTRA_PARAM: {
    'userCode': 'user-1', 'chatSessionId': 'session-1', 'resourceId': '42',
}}
HEADERS = {USER_CODE_HEADER: 'user-1', CHAT_SESSION_ID_HEADER: 'session-1', RESOURCE_ID_HEADER: '42'}


def file_event(status='SUCCEEDED'):
    return build_file_build_terminal_event({
        'kid': 1, 'kb_code': 'kb-1', 'knowledge_base_id': 168,
        'batch_id': 'batch-1', 'fs_entry_id': 10,
        'file_path_snapshot': '/Docs/a.md', 'status': status,
        'current_stage': 'committing', 'result_payload': {'chunkCount': 2, 'lineCount': 10},
    })


def batch_event(**overrides):
    batch = dict(batch_id='batch-1', kb_code='kb-1', knowledge_base_id=168,
                 scope='DIRECTORY', target_path_snapshot='/Docs', candidate_count=4,
                 eligible_count=3, accepted_count=2, reused_count=1,
                 acceptance_skipped_count=1, completed_count=2)
    batch.update(overrides)
    return build_file_build_batch_terminal_event(batch, {'succeeded': 1, 'unsupported': 1})


@pytest.mark.parametrize(('status', 'expected'), [
    ('SUCCEEDED', '已完成'), ('FAILED', '构建失败-待重试'),
    ('SKIPPED', '待构建'), ('UNSUPPORTED', '不支持构建'),
])
async def test_v2_file_callback_recovers_build_batch_context(status, expected):
    post = AsyncMock(return_value={'resultCode': '0'})
    context = AsyncMock(return_value=CONTEXT)
    publisher = ByClawKnowledgeEventPublisher(
        post_json=post, build_batch_context_resolver=context,
        batch_context_resolver=MagicMock(side_effect=AssertionError('semantic lookup')),
        beyond_token_resolver=lambda _: 'token',
        knowledge_base_resolver=lambda _: {'kid': 168, 'kb_name': '知识库'},
    )
    await publisher.publish(file_event(status))
    context.assert_awaited_once_with('batch-1', 'kb-1')
    item = post.await_args.args[1]['objectFiles'][0]
    assert item['filePath'] == '/Docs/a.md'
    assert item['statusCd'] == expected
    assert post.await_args.args[2]['X-CHAT-SESSION-ID'] == 'session-1'


async def test_build_batch_notifies_without_chat_session_and_counts_unsupported():
    get = AsyncMock(return_value={'resultCode': '0'})
    post = MagicMock()
    publisher = ByClawKnowledgeEventPublisher(
        get_json=get, post_json=post, user_id_resolver=lambda _: '77',
        batch_details_resolver=lambda _: {'kb_name': '研发知识库', 'files': []},
        beyond_token_resolver=lambda _: 'token',
        build_batch_context_resolver=lambda *_: {
            CALLBACK_CONTEXT_EXTRA_PARAM: {'userCode': 'user-1', 'resourceId': '42'}},
    )
    await publisher.publish(batch_event())
    content = get.await_args.args[1]['content']
    assert '【文件构建】处理结束，部分文件未完成处理' in content
    for line in ('不支持 1', '复用 1', '受理时跳过 1', '处理范围：/Docs'):
        assert line in content
    post.assert_not_called()


def test_empty_build_batch_does_not_claim_reused_tasks_completed():
    event = build_file_build_batch_terminal_event(dict(
        batch_id='batch-1', kb_code='kb-1', knowledge_base_id=168, scope='DIRECTORY',
        target_path_snapshot='/', candidate_count=1, eligible_count=1,
        accepted_count=0, reused_count=1, acceptance_skipped_count=0, completed_count=0,
    ), {})
    assert '本次未新建处理任务' in _build_batch_notification(event, resource_id='42')


@pytest.mark.parametrize('event', [file_event(), batch_event()])
async def test_build_callbacks_skip_missing_identity(event):
    post, get = MagicMock(), MagicMock()
    publisher = ByClawKnowledgeEventPublisher(
        post_json=post, get_json=get, build_batch_context_resolver=lambda *_: {})
    await publisher.publish(event)
    post.assert_not_called()
    get.assert_not_called()


async def test_build_context_lookup_uses_build_table_and_kb_id():
    connection = MagicMock(close=AsyncMock())
    with (
        patch('byclaw_knowledge_event_publisher.build_connection_factory',
              return_value=AsyncMock(return_value=connection)),
        patch('byclaw_knowledge_event_publisher.KnowledgeBaseRepository.get_by_code',
              new=AsyncMock(return_value={'kid': 168})),
        patch('byclaw_knowledge_event_publisher.KnowledgeBuildBatchRepository.get_batch',
              new=AsyncMock(return_value={'extra_params': CONTEXT})) as get_batch,
    ):
        assert await _resolve_build_batch_context_from_db('batch-1', 'kb-1') == CONTEXT
    assert get_batch.await_args.kwargs == {'batch_id': 'batch-1', 'knowledge_base_id': 168}
    connection.close.assert_awaited_once()


@pytest.mark.parametrize('headers', [HEADERS, {}])
async def test_build_acceptance_overwrites_untrusted_context(headers):
    token = set_byclaw_userfs_headers(headers)
    try:
        with patch('byclaw_knowledge_entity_runtime.KnowledgeBuildAcceptanceRepository.accept', new=AsyncMock()) as create:
            await ByClawKnowledgeBuildAcceptanceRepository('embedding').accept(MagicMock(), extra_params={
                CALLBACK_CONTEXT_EXTRA_PARAM: {'userCode': 'spoofed'}, 'other': 1})
        extra = create.await_args.kwargs['extra_params']
        assert extra == ({**CONTEXT, 'other': 1} if headers else {'other': 1})
    finally:
        reset_byclaw_userfs_headers(token)


@pytest.mark.parametrize('failed', [False, True])
async def test_build_runner_restores_and_resets_context(failed):
    async def execute(_row):
        assert get_byclaw_userfs_header_context() == HEADERS
        if failed:
            raise RuntimeError('execution failed')
    runner = object.__new__(ByClawFileBuildBackgroundRunner)
    before = get_byclaw_userfs_header_context()
    with patch('byclaw_knowledge_entity_runtime.FileBuildBackgroundRunner._execute_claimed',
               new=AsyncMock(side_effect=execute)):
        if failed:
            with pytest.raises(RuntimeError):
                await runner._execute_claimed({'extra_params': CONTEXT})
        else:
            await runner._execute_claimed({'extra_params': CONTEXT})
    assert get_byclaw_userfs_header_context() == before


def test_build_runtime_is_installed():
    from by_qa.knowledge_base.infrastructure import runtime
    install_byclaw_knowledge_entity_runtime()
    assert runtime.KnowledgeBuildAcceptanceRepository is ByClawKnowledgeBuildAcceptanceRepository
    assert runtime.FileBuildBackgroundRunner is ByClawFileBuildBackgroundRunner


@pytest.mark.parametrize('scope', ['SINGLE_FILE', 'DIRECTORY'])
async def test_real_acceptance_sql_persists_context_on_batch_and_tasks(scope):
    import json

    cursor = MagicMock(execute=AsyncMock(), fetchone=AsyncMock(return_value={}),
                       fetchall=AsyncMock(return_value=[]))
    token = set_byclaw_userfs_headers(HEADERS)
    try:
        await ByClawKnowledgeBuildAcceptanceRepository('embedding').accept(
            cursor, batch_id='batch-1', knowledge_base_id=168, scope=scope,
            target_path_snapshot='/Docs', target_fs_entry_id=10,
            target_path_ltree='root.docs', build_profile={}, build_profile_hash='hash',
            force=False, priority=0,
        )
    finally:
        reset_byclaw_userfs_headers(token)
    writes = [call.args for call in cursor.execute.await_args_list
              if 'INSERT INTO knowledge_build_batch' in call.args[0]
              or 'INSERT INTO knowledge_build_task' in call.args[0]]
    assert len(writes) == 2
    for sql, params in writes:
        assert '%(extra_params)s::jsonb' in sql
        assert json.loads(params['extra_params']) == CONTEXT


async def test_build_callback_uses_original_batch_owner_during_another_request():
    post = AsyncMock(return_value={'resultCode': '0'})
    publisher = ByClawKnowledgeEventPublisher(
        post_json=post, build_batch_context_resolver=lambda *_: CONTEXT,
        beyond_token_resolver=lambda _: 'token',
        knowledge_base_resolver=lambda _: {'kid': 168, 'kb_name': '知识库'},
    )
    token = set_byclaw_userfs_headers({**HEADERS, USER_CODE_HEADER: 'another-user',
                                    CHAT_SESSION_ID_HEADER: 'another-session'})
    try:
        await publisher.publish(file_event('SKIPPED'))
    finally:
        reset_byclaw_userfs_headers(token)
    assert post.await_args.args[2]['X-User-Code'] == 'user-1'
    assert post.await_args.args[2]['X-CHAT-SESSION-ID'] == 'session-1'
