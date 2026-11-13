"""Keyless tests of the actual lease-local runner; no online model or user files."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import tomllib
import unittest
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('coding_workspace', Path(__file__).with_name('coding-workspace.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class WorkspaceTests(unittest.TestCase):
    def repository(self, name='repo', base=None):
        repo = (base or self.cwd) / name
        repo.mkdir(parents=True)
        subprocess.run(['git', 'init', str(repo)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'false'], check=True, capture_output=True)
        (repo / 'AGENTS.md').write_text('PROJECT_RULE_CHECK\n', encoding='utf-8', newline='\n')
        (repo / 'app.txt').write_text('initial\n', encoding='utf-8', newline='\n')
        subprocess.run(['git', '-C', str(repo), 'add', '.'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '-m', 'Initial fixture'], check=True, capture_output=True)
        return repo

    def resolve(self, name='repo', previous=None, workspace=None):
        return runner.resolve_workspace(dict(workspace=workspace or self.manifest['workspace'], repoDir=name,
                                             previousCwd=previous), self.by)

    def test_repository_cwd_is_pinned_across_config_changes_and_private_sessions(self):
        repo = self.repository()
        first = self.resolve()
        self.assertEqual(first['cwd'], str(repo))
        self.assertEqual(first['defaultOutputRoot'], str(repo))
        self.assertEqual(first['repository'], str(repo))
        other = dict(self.manifest['workspace'], sessionRoot=str(self.by / '.sessions' / 'private2'))
        self.assertEqual(self.resolve('app', workspace=other)['cwd'], str(repo))
        self.assertFalse((self.cwd / 'app').exists())
        self.manifest['workspace'] = first
        calls, _ = self.run_cli()
        self.assertEqual(calls[0][1]['cwd'], repo)
        self.assertEqual((repo / 'AGENTS.md').read_text(), 'PROJECT_RULE_CHECK\n')
        self.assertEqual(self.resolve('app', previous=str(repo))['cwd'], str(repo))
        calls, _ = self.run_cli()
        self.assertIn('resume', calls[0][0])

    def test_custom_name_default_minus_one_and_independent_session_repository(self):
        repo = self.repository('app')
        self.assertEqual(self.resolve('app')['cwd'], str(repo))
        for base in [self.by / '.shared' / 'project_-1', Path(self.manifest['workspace']['sessionRoot'])]:
            repo = self.repository(base=base)
            workspace = dict(self.manifest['workspace'], cwd=str(base), defaultOutputRoot=str(base))
            self.assertEqual(self.resolve(workspace=workspace)['cwd'], str(repo))

    def test_greeting_keeps_default_directory_and_does_not_create_repository(self):
        selected = self.resolve()
        self.assertEqual(selected['cwd'], str(self.cwd))
        self.assertNotIn('repository', selected)
        self.assertFalse((self.cwd / 'repo').exists())
        self.assertFalse((self.cwd / '.byclaw').exists())

    def test_incomplete_repository_missing_agents_and_external_git_are_rejected(self):
        repo = self.cwd / 'repo'
        repo.mkdir(parents=True)
        # A parent repository must never make an empty child appear valid.
        subprocess.run(['git', 'init', str(self.cwd)], check=True, capture_output=True)
        self.assertEqual(self.resolve()['cwd'], str(self.cwd))
        self.assertEqual(self.resolve()['repositoryIssue'], 'EXECUTION_REPOSITORY_INVALID')
        (repo / '.git').write_text('gitdir: ../.git', encoding='utf-8')
        self.assertEqual(self.resolve()['repositoryIssue'], 'EXECUTION_REPOSITORY_INVALID')
        (repo / '.git').unlink()
        subprocess.run(['git', 'init', str(repo)], check=True, capture_output=True)
        self.assertEqual(self.resolve()['repositoryIssue'], 'EXECUTION_REPOSITORY_INVALID')

    def test_missing_bound_repository_and_cwd_switch_fail_instead_of_falling_back(self):
        repo = self.repository()
        with self.assertRaisesRegex(ValueError, 'WORKSPACE_CHANGED'):
            self.resolve(previous=str(self.cwd))
        self.resolve()
        (repo / 'AGENTS.md').unlink()
        with self.assertRaisesRegex(ValueError, 'REPOSITORY_INVALID'):
            self.resolve()

    def test_recovered_repository_never_uses_repo_repo_and_cross_project_is_rejected(self):
        repo = self.repository('old-app')
        selected = self.resolve(previous=str(repo))
        self.assertEqual(selected['cwd'], str(repo))
        workspace = dict(selected, cwd=str(self.by / '.shared' / 'project_9'))
        with self.assertRaisesRegex(ValueError, 'PROJECT_BINDING_CHANGED'):
            self.resolve(previous=str(repo), workspace=workspace)

    def test_directory_config_and_parent_traversal_are_rejected(self):
        for value in ['', '.', '..', '/repo', 'a/b', 'a\\b', ' a', 'C:repo', 'a\0b']:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'INVALID_REPO_DIR'):
                self.resolve(value)
        with self.assertRaisesRegex(ValueError, 'UNSAFE_WORKSPACE'):
            runner.safe_directory(self.by / '..' / 'outside', self.by)

    def test_repository_state_uses_real_head_and_tracks_uncommitted_files(self):
        repo = self.repository()
        state = runner.repository_state(repo, self.by)
        self.assertRegex(state['revision'], r'^[a-f0-9]{40}$')
        self.assertFalse(state['dirty'])
        (repo / 'app.txt').write_text('modified\n', encoding='utf-8', newline='\n')
        self.assertTrue(runner.repository_state(repo, self.by)['dirty'])
        (repo / 'app.txt').write_text('initial\n', encoding='utf-8', newline='\n')
        (repo / 'untracked.txt').touch()
        self.assertTrue(runner.repository_state(repo, self.by)['dirty'])

    def test_repository_is_rechecked_before_cli_and_project_rules_are_not_replaced(self):
        repo = self.repository()
        self.manifest['workspace'] = self.resolve()
        (repo / 'AGENTS.md').unlink()
        with patch.object(runner.subprocess, 'Popen') as cli:
            with self.assertRaisesRegex(ValueError, 'REPOSITORY_INVALID'):
                runner.run(self.manifest, 'task', self.by)
            cli.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'Native symlinks require Windows developer privileges')
    def test_symlink_repository_never_escapes_the_mounted_space(self):
        repo = self.repository('actual')
        (self.cwd / 'repo').symlink_to(repo, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'UNSAFE_STATE_PATH'):
            self.resolve()

    @unittest.skipIf(os.name == 'nt', 'POSIX deployment credential permissions and /tmp')
    def test_deployment_context_is_local_private_stripped_and_cleaned_on_failure(self):
        source = dict(CODEX_AUTH='model-auth', BYCLAW_DEPLOY_ENABLED='1',
                      BYCLAW_DEPLOY_PRIVATE_KEY='synthetic-only', BYCLAW_DEPLOY_HOST='example.invalid')
        contexts = []
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            with runner.deployment_environment(source) as environment:
                self.assertEqual(environment['CODEX_AUTH'], 'model-auth')
                self.assertNotIn('BYCLAW_DEPLOY_PRIVATE_KEY', environment)
                path = Path(environment['BYCLAW_DEPLOY_CONTEXT'])
                contexts.append(path)
                self.assertEqual(path.parent.parent, Path('/tmp'))
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
                self.assertEqual(json.loads(path.read_text())['private_key'], 'synthetic-only')
                with runner.deployment_environment(source) as other:
                    self.assertNotEqual(environment['BYCLAW_DEPLOY_CONTEXT'], other['BYCLAW_DEPLOY_CONTEXT'])
                raise RuntimeError('cancelled')
        self.assertFalse(contexts[0].parent.exists())
        with runner.deployment_environment(dict(source, BYCLAW_DEPLOY_ENABLED='0')) as environment:
            self.assertEqual(environment, {'CODEX_AUTH': 'model-auth'})

    @unittest.skipIf(os.name == 'nt', 'Linux process groups are used by the coding image')
    def test_native_runner_scopes_deployment_context_without_persisting_it(self):
        observed = []
        def verify(args, kwargs):
            path = Path(kwargs['env']['BYCLAW_DEPLOY_CONTEXT'])
            observed.append(path)
            self.assertTrue(path.is_file())
            self.assertNotIn('BYCLAW_DEPLOY_PRIVATE_KEY', kwargs['env'])
            self.assertNotIn('BYCLAW_DEPLOY_PRIVATE_KEY', os.environ)
            self.assertNotIn('synthetic-only', json.dumps(args))
            self.assertTrue(kwargs['start_new_session'])
        with patch.dict(os.environ, {'BYCLAW_DEPLOY_ENABLED': '1', 'BYCLAW_DEPLOY_PRIVATE_KEY': 'synthetic-only'}):
            with patch.object(runner.os, 'killpg') as kill:
                self.run_cli(verify)
                kill.assert_called_once()
        self.assertFalse(observed[0].parent.exists())
        for file in self.by.rglob('*'):
            if file.is_file():
                self.assertNotIn(b'synthetic-only', file.read_bytes())

    def test_internal_control_files_are_not_user_file_changes(self):
        control = self.by / '.byclaw'
        control.mkdir()
        (control / 'group-chat-disposition.json').write_text('{"kind":"TASK"}')
        (self.by / 'result.txt').write_text('deliverable')
        entries, _ = runner.scan(self.by)
        self.assertIn('result.txt', entries)
        self.assertNotIn('.byclaw/group-chat-disposition.json', entries)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='coding-workspace-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.by = self.root / 'by'
        self.by.mkdir()
        self.defaults = self.root / 'image'
        self.defaults.mkdir()
        self.default_config = 'model="image-model"\nmodel_provider="byclaw"\n[model_providers.byclaw]\nbase_url="https://example.invalid/v1"\nenv_key="CODEX_AUTH"\nwire_api="responses"\n'
        (self.defaults / 'config.toml').write_text(self.default_config, encoding='utf-8')
        session = self.by / '.sessions' / 's1'
        cwd = self.by / '.shared' / 'project_8'
        self.manifest = dict(version=1, identity='identity-a', employeeId='1001', messageId='m1', persona='RULE_CHECK', skills=[],
            workspace=dict(sessionRoot=str(session), cwd=str(cwd), defaultOutputRoot=str(cwd), sharedRoot=str(self.by / '.shared')),
            home=str(session / 'executors' / '1001' / 'codex-home'))
        self.home = Path(self.manifest['home'])
        self.cwd = cwd

    def run_cli(self, callback=None, manifest=None):
        calls = []
        thread = '12345678-1234-1234-1234-123456789abc'
        class Child:
            def __init__(child, args, **kwargs):
                child.pid = 99999999
                calls.append((args, kwargs))
                if callback:
                    callback(args, kwargs)
                native = Path(kwargs['env']['CODEX_HOME']) / 'sessions' / ('rollout-' + thread + '.jsonl')
                native.parent.mkdir(exist_ok=True)
                native.write_text('native state', encoding='utf-8')
                child.stdin = io.StringIO()
                child.stdout = io.StringIO('\n'.join(json.dumps(item) for item in [
                    dict(type='thread.started', thread_id=thread), dict(type='turn.started'),
                    dict(type='item.completed', item=dict(id='answer', type='agent_message', text='done')), dict(type='turn.completed')]) + '\n')
            def wait(child):
                return 0
            def poll(child):
                return 0
        output = io.StringIO()
        actual_popen = subprocess.Popen
        def launch(args, **kwargs):
            return Child(args, **kwargs) if args[0] == 'codex' else actual_popen(args, **kwargs)
        with patch.dict(os.environ, dict(CODEX_HOME=str(self.defaults), CODEX_AUTH='test-auth-not-a-prompt', CODEX_MODEL='override-model', CODEX_BASE_URL='https://override.invalid/v1', BYCLAW_CODEX_CONNECTION=json.dumps(dict(model='platform-model', baseUrl='https://platform.invalid/v1', apiKey='platform-secret', reasoningEffort='high')))):
            with patch.object(runner.subprocess, 'Popen', launch), contextlib.redirect_stdout(output):
                code = runner.run(manifest or self.manifest, 'current task', self.by)
        self.assertEqual(code, 0)
        return calls, [json.loads(line) for line in output.getvalue().splitlines()]

    def test_config_identity_resume_and_rule_update(self):
        self.cwd.mkdir(parents=True)
        original = self.cwd / 'AGENTS.md'
        original.write_text('project policy', encoding='utf-8')
        calls, _ = self.run_cli()
        data = tomllib.loads((self.home / 'config.toml').read_text(encoding='utf-8'))
        self.assertNotIn('model', data)
        self.assertNotIn('model_providers', data)
        self.assertNotIn('test-auth', (self.home / 'config.toml').read_text())
        self.assertEqual(data['developer_instructions'], 'RULE_CHECK')
        self.assertEqual(calls[0][1]['env']['CODEX_HOME'], str(self.home))
        self.assertEqual(calls[0][1]['env']['DSH_BYCLAW_AGENT_ID'], '1001')
        self.assertIn('platform-model', calls[0][0])
        self.assertNotIn('override-model', str(calls))
        self.assertNotIn('platform-secret', str(calls[0][0]))
        self.assertEqual(calls[0][1]['env']['BYCLAW_CODEX_API_KEY'], 'platform-secret')
        for key in ('CODEX_AUTH', 'CODEX_MODEL', 'CODEX_BASE_URL', 'BYCLAW_CODEX_CONNECTION'):
            self.assertNotIn(key, calls[0][1]['env'])
        self.assertEqual(calls[0][0][-1], '-')
        self.manifest['persona'] = 'UPDATED_RULE'
        calls, events = self.run_cli()
        self.assertIn('resume', calls[0][0])
        self.assertIn('12345678-1234-1234-1234-123456789abc', calls[0][0])
        self.assertTrue(any(event.get('status') == 'resumed' for event in events))
        self.assertEqual((self.home / 'AGENTS.md').read_text().strip(), 'UPDATED_RULE')
        self.assertEqual(original.read_text(), 'project policy')
        self.assertEqual((self.defaults / 'config.toml').read_text(), self.default_config)

    def test_mcp_publication_tool_is_scoped_to_the_lease(self):
        self.cwd.mkdir(parents=True)
        manifest = dict(self.manifest, publication={
            'description': 'publication fixture',
            'mode': 'mcp',
            'bridgeId': str(uuid.uuid4()),
            'binding': {'taskId': '3001', 'userCode': 'fixture-user', 'groupSessionId': '2001'},
            'baseUrl': 'http://example.invalid/byaiService',
        })
        self.run_cli(manifest=manifest)
        config = tomllib.loads((self.home / 'config.toml').read_text(encoding='utf-8'))
        server = config['mcp_servers']['byclaw_group_task_publication']
        self.assertEqual(server['command'], 'python3')
        self.assertEqual(Path(server['args'][0]), self.home / 'byclaw-publication-mcp.py')
        self.assertEqual(Path(server['args'][1]), self.home / 'byclaw-publication-binding.json')
        self.assertIn('prepare_group_task_publication', (self.home / 'byclaw-publication-mcp.py').read_text(encoding='utf-8'))
        binding = json.loads((self.home / 'byclaw-publication-binding.json').read_text(encoding='utf-8'))
        self.assertEqual(binding['bridgeDirectory'], str(self.home / '.publication' / manifest['publication']['bridgeId']))
        self.assertNotIn('binding', binding)
        self.assertNotIn('baseUrl', binding)
        self.assertNotIn('env', server)
        self.assertNotIn('env_vars', server)
        self.assertNotIn('BEYOND_TOKEN', (self.home / 'byclaw-publication-mcp.py').read_text(encoding='utf-8'))
        self.assertFalse(Path(binding['bridgeDirectory']).exists(), 'turn-local IPC is cleaned after CLI exit')
        self.assertNotIn('test-auth', (self.home / 'byclaw-publication-binding.json').read_text(encoding='utf-8'))

    def mcp_call(self, respond, arguments=None):
        directory = self.home / '.publication' / str(uuid.uuid4())
        directory.mkdir(parents=True)
        bridge = runner.PublicationBridge(directory, directory.name)
        program = self.root / 'publication-mcp.py'
        program.write_text(runner.PUBLICATION_MCP_SERVER, encoding='utf-8')
        binding = self.root / 'bridge.json'
        binding.write_text(json.dumps({'bridgeDirectory': str(directory)}), encoding='utf-8')
        received = []
        def host(kind, **event):
            self.assertEqual(kind, 'byclaw.publication.request')
            self.assertEqual(event['bridgeId'], directory.name)
            received.append(event)
            runner.atomic_text(directory / (event['requestId'] + '.response.json'), json.dumps(respond(event)))
        with patch.object(runner, 'emit', host):
            bridge.start()
            try:
                process = subprocess.run([sys.executable, str(program), str(binding)],
                    input=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                        'params': {'name': 'prepare_group_task_publication', 'arguments': arguments or {'text': '成果', 'sourcePaths': []}}}) + '\n',
                    env=dict({key: value for key, value in os.environ.items() if key not in ('BEYOND_TOKEN', 'SSO_TOKEN')}, PYTHONIOENCODING='utf-8'),
                    capture_output=True, text=True, encoding='utf-8', timeout=10)
            finally:
                bridge.close()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(received), 1)
        self.assertFalse(directory.exists())
        return json.loads(process.stdout)['result'], received[0]

    def test_real_mcp_process_uses_host_response_without_login_environment(self):
        card = {'taskId': '3001', 'pendingPublicationId': '4001', 'text': '成果', 'sourcePaths': [], 'createTime': 'fixture-time'}
        result, request = self.mcp_call(lambda event: {'result': card})
        self.assertNotIn('isError', result)
        self.assertEqual(json.loads(result['content'][0]['text']), card)
        self.assertEqual(request['arguments'], {'text': '成果', 'sourcePaths': []})
        self.assertNotIn('userCode', request)
        self.assertNotIn('taskId', request)

    def test_real_mcp_returns_host_error_without_retrying(self):
        result, _ = self.mcp_call(lambda event: {'error': 'host publication failed; check pending card'})
        self.assertTrue(result['isError'])
        self.assertIn('host publication failed', result['content'][0]['text'])

    def test_bridge_forwards_each_request_once_and_stops_on_close(self):
        directory = self.root / 'ipc'
        directory.mkdir()
        bridge = runner.PublicationBridge(directory, str(uuid.uuid4()))
        request = directory / (str(uuid.uuid4()) + '.request.json')
        request.write_text(json.dumps({'arguments': {'text': 'fixture'}}), encoding='utf-8')
        events = []
        with patch.object(runner, 'emit', lambda *args, **kwargs: events.append(kwargs)):
            bridge.start()
            try:
                deadline = time.monotonic() + 2
                while not events and time.monotonic() < deadline:
                    time.sleep(0.01)
                time.sleep(0.15)
            finally:
                bridge.close()
        self.assertEqual(len(events), 1)
        self.assertFalse(bridge.worker.is_alive())

    def test_bridge_rejects_invalid_request_json_without_forwarding(self):
        directory = self.root / 'ipc'
        directory.mkdir()
        request_id = str(uuid.uuid4())
        (directory / (request_id + '.request.json')).write_text('invalid-json', encoding='utf-8')
        bridge = runner.PublicationBridge(directory, str(uuid.uuid4()))
        with patch.object(runner, 'emit') as forwarded:
            bridge.start()
            try:
                response = directory / (request_id + '.response.json')
                deadline = time.monotonic() + 2
                while not response.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertIn('error', json.loads(response.read_text(encoding='utf-8')))
            finally:
                bridge.close()
            forwarded.assert_not_called()

    def test_missing_native_state_recreates_but_foreign_identity_rejects(self):
        self.run_cli()
        for file in (self.home / 'sessions').glob('*'):
            file.unlink()
        calls, events = self.run_cli()
        self.assertNotIn('resume', calls[0][0])
        self.assertTrue(any(event.get('status') == 'recreated' for event in events))
        self.manifest['identity'] = 'other-user'
        with self.assertRaisesRegex(ValueError, 'SCOPE_MISMATCH'):
            self.run_cli()

    def test_existing_file_binary_shell_output_and_session_artifact_use_original_protocol(self):
        self.cwd.mkdir(parents=True)
        (self.cwd / 'old.txt').write_text('old\n', encoding='utf-8', newline='\n')
        def write_files(args, kwargs):
            (self.cwd / 'old.txt').write_text('new\n', encoding='utf-8', newline='\n')
            nested = self.cwd / 'reports' / 'deep'
            nested.mkdir(parents=True)
            (nested / 'result.md').write_text('RULE_CHECK\nreport\n', encoding='utf-8')
            (nested / 'archive.zip').write_bytes(b'PK\0binary')
            (Path(self.manifest['workspace']['sessionRoot']) / 'session.txt').write_text('session\n', encoding='utf-8')
        _, events = self.run_cli(write_files)
        summaries = [event for event in events if event['type'] == 'byclaw.file_changes']
        self.assertEqual(len(summaries), 2)
        details = []
        for summary in summaries:
            self.assertEqual(summary['payload']['version'], 2)
            for file in summary['payload']['files']:
                path = self.by / '.file_changes' / 's1' / 'files' / (file['uuid'] + '.json')
                details.append(json.loads(path.read_text(encoding='utf-8')))
        modified = next(item for item in details if item['filePath'] == 'old.txt')
        self.assertEqual(modified['originalContent'], 'old\n')
        self.assertEqual(modified['modifiedContent'], 'new\n')
        archive = next(item for item in details if item['filePath'].endswith('.zip'))
        self.assertTrue(archive['binary'])
        self.assertTrue(archive['modifiedExists'])
        self.assertEqual(archive['modifiedSize'], len(b'PK\0binary'))
        self.assertFalse(any('executors/' in item['filePath'] for item in details))
        self.assertFalse(list(self.by.rglob('HANDOFF.md')))
        self.assertFalse(list(self.by.rglob('delivery.json')))

    def test_missing_skill_mount_fails_before_model(self):
        self.manifest['skills'] = [dict(name='missing', path=str(self.root / 'missing' / 'SKILL.md'), enabled=True)]
        with self.assertRaisesRegex(ValueError, 'SKILL_MOUNT_MISSING'):
            self.run_cli()

    def test_tool_preparation_runs_before_cli_and_failure_stops_execution(self):
        self.manifest['prepareAgentSkills'] = True
        observed = []
        def preparation(manifest, root):
            self.assertNotIn('BYCLAW_CODEX_CONNECTION', os.environ)
            self.assertNotIn('BYCLAW_CODEX_API_KEY', os.environ)
            self.assertNotIn('CODEX_AUTH', os.environ)
            observed.append((manifest['employeeId'], root))
            manifest['skills'] = []
        with patch.object(runner, 'prepare_agent_skills', preparation):
            self.run_cli(lambda *_: self.assertEqual(len(observed), 1))
        self.assertEqual(observed, [('1001', self.by)])
        with patch.dict(os.environ, BYCLAW_CODEX_CONNECTION=json.dumps(dict(model='test', baseUrl='https://example.invalid/v1', apiKey='test'))), patch.object(runner, 'prepare_agent_skills', side_effect=ValueError('EXECUTION_SKILL_AUTH_FAILED')):
            with patch.object(runner.subprocess, 'Popen') as cli:
                with self.assertRaisesRegex(ValueError, 'SKILL_AUTH_FAILED'):
                    runner.run(self.manifest, 'task', self.by)
                cli.assert_not_called()

    def test_missing_platform_connection_stops_before_skills_or_cli(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(runner, 'prepare_agent_skills') as skills:
            with patch.object(runner.subprocess, 'Popen') as cli:
                with self.assertRaisesRegex(ValueError, 'CODEX_MODEL_CONNECTION_UNAVAILABLE'):
                    runner.run(self.manifest, 'task', self.by)
                skills.assert_not_called()
                cli.assert_not_called()

    def test_actual_preparer_child_receives_identity_and_existing_environment(self):
        program = self.root / 'prepare-fixture.mjs'
        program.write_text('''
import assert from 'node:assert/strict';
assert.equal(process.argv[2], '1001');
assert.equal(process.env.BEYOND_TOKEN, 'synthetic-auth');
assert.ok(process.argv[3]);
process.stdout.write(JSON.stringify({skills:[]}));
''', encoding='utf-8')
        with patch.dict(os.environ, dict(BYCLAW_AGENT_SKILLS_PREPARER=str(program), BEYOND_TOKEN='synthetic-auth')):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                runner.prepare_agent_skills(self.manifest, self.by)
        self.assertEqual(self.manifest['skills'], [])
        self.assertIn('skills-ready', output.getvalue())
        self.assertNotIn('synthetic-auth', output.getvalue())
        program.write_text('process.stderr.write("private credential diagnostic\\nEXECUTION_SKILL_AUTH_FAILED\\n");process.exit(1)', encoding='utf-8')
        with patch.dict(os.environ, dict(BYCLAW_AGENT_SKILLS_PREPARER=str(program))):
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError, '^EXECUTION_SKILL_AUTH_FAILED$'):
                    runner.prepare_agent_skills(self.manifest, self.by)

    def test_missing_preparer_fails_instead_of_using_empty_skills(self):
        with patch.dict(os.environ, dict(BYCLAW_AGENT_SKILLS_PREPARER='')):
            with self.assertRaisesRegex(ValueError, 'SKILL_PREPARER_MISSING'):
                runner.prepare_agent_skills(self.manifest, self.by)

    def test_cancel_preparation_terminates_child_and_releases_cache_lock(self):
        class Child:
            stdout = io.StringIO()
            stderr = io.StringIO()
            stopped = False
            def communicate(child):
                raise KeyboardInterrupt()
            def poll(child):
                return 130 if child.stopped else None
            def terminate(child):
                child.stopped = True
            def wait(child, timeout=None):
                return 130
        child = Child()
        program = self.root / 'cancel-fixture.mjs'
        program.touch()
        with patch.dict(os.environ, dict(BYCLAW_AGENT_SKILLS_PREPARER=str(program))):
            with patch.object(runner.subprocess, 'Popen', return_value=child), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt):
                    runner.prepare_agent_skills(self.manifest, self.by)
        self.assertTrue(child.stopped)
        with runner.identity_lock(self.by / '.byclaw' / '.agent-skills.lock'):
            pass

    def test_effective_skill_view_removes_revoked_links_between_tasks(self):
        source = self.root / 'source'
        source.mkdir()
        (source / 'SKILL.md').write_text('---\nname: associated-demo\ndescription: fixture\n---\n', encoding='utf-8')
        self.manifest['skills'] = [dict(name='associated-demo', path=str(source / 'SKILL.md'), enabled=True)]
        try:
            self.run_cli()
        except OSError as error:
            if os.name == 'nt' and getattr(error, 'winerror', None) == 1314:
                self.skipTest('Windows account lacks symlink privilege; verify native links in the Linux image')
            raise
        link = self.home / 'skills' / 'associated-demo'
        self.assertTrue(link.is_symlink())
        self.manifest['skills'] = []
        self.run_cli()
        self.assertFalse(link.is_symlink())

    def test_oversized_scan_never_invents_deletions(self):
        before = ({'unseen.txt': dict(size=1, text='a')}, True)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            runner.file_changes(self.cwd, 's1', before, ({}, False), self.by)
        self.assertNotIn('file_changes', output.getvalue())
        self.assertIn('partial', output.getvalue())

    def test_real_cross_process_lock_serializes_same_identity(self):
        lock = self.root / 'shared.lock'
        program = ('import importlib.util,time,sys\n'
            's=importlib.util.spec_from_file_location("runner",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n'
            'from pathlib import Path\n'
            'with m.identity_lock(Path(sys.argv[2])):\n'
            ' print("ENTER",time.monotonic(),flush=True);time.sleep(.3);print("EXIT",time.monotonic(),flush=True)\n')
        args = [sys.executable, '-c', program, str(Path(runner.__file__)), str(lock)]
        first = subprocess.Popen(args, stdout=subprocess.PIPE, text=True)
        self.assertTrue(first.stdout.readline().startswith('ENTER'))
        second = subprocess.Popen(args, stdout=subprocess.PIPE, text=True)
        first_output = first.communicate(timeout=10)[0]
        second_output = second.communicate(timeout=10)[0]
        left = float(next(line.split()[1] for line in first_output.splitlines() if line.startswith('EXIT')))
        right = float(next(line.split()[1] for line in second_output.splitlines() if line.startswith('ENTER')))
        self.assertGreaterEqual(right, left)
        self.assertEqual(first.returncode, 0)
        self.assertEqual(second.returncode, 0)


if __name__ == '__main__':
    unittest.main()
