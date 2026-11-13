"""Exercise the pinned real CLI against a local Responses fixture, without a real key/model.

Usage: python coding-native-exec-verify.py /path/to/codex
Checks real config loading, argv/stdin, structured final output and explicit resume.
This does not establish compatibility with a deployed gateway or real model.
"""
import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('coding_workspace', Path(__file__).with_name('coding-workspace.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
requests = []


class Responses(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers['Content-Length']))
        requests.append({**json.loads(raw), '_fixture_auth': self.headers.get('Authorization'), '_fixture_path': self.path})
        answer = json.dumps(dict(answer='NATIVE_EXEC_OK', publication=None))
        item = dict(id='msg_fixture', type='message', role='assistant', status='completed',
                    content=[dict(type='output_text', text=answer, annotations=[])])
        response = dict(id='resp_fixture_' + str(len(requests)), object='response', created_at=int(time.time()),
                        model='test-model', status='completed', output=[item],
                        usage=dict(input_tokens=8, output_tokens=3, total_tokens=11))
        events = [dict(type='response.created', response={**response, 'status': 'in_progress', 'output': []}),
                  dict(type='response.output_item.added', output_index=0, item={**item, 'status': 'in_progress', 'content': []}),
                  dict(type='response.output_text.delta', item_id=item['id'], output_index=0, content_index=0, delta=answer),
                  dict(type='response.output_item.done', output_index=0, item=item),
                  dict(type='response.completed', response=response)]
        body = ''.join('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n' for event in events).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    executable = Path(sys.argv[1]).resolve()
    assert subprocess.check_output([str(executable), '--version'], text=True, timeout=30).strip() == 'codex-cli 0.167.0'
    server = ThreadingHTTPServer(('127.0.0.1', 0), Responses)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='byclaw-native-exec-') as temporary:
            root = Path(temporary)
            by = root / 'by'
            by.mkdir()
            default = root / 'image-home'
            default.mkdir()
            (default / 'config.toml').write_text(runner.toml_document(dict(model='test-model', model_provider='byclaw',
                model_providers=dict(byclaw=dict(name='local-fixture', base_url=f'http://127.0.0.1:{server.server_port}/v1',
                    wire_api='responses', env_key='CODEX_AUTH', requires_openai_auth=False)))), encoding='utf-8')
            session = by / '.sessions' / 's1'
            home = session / 'executors' / '1001' / 'codex-home'
            manifest = dict(version=1, identity='native-test-identity', employeeId='1001', messageId='m1', persona='RULE_FIRST', skills=[],
                home=str(home), workspace=dict(sessionRoot=str(session), sharedRoot=str(by / '.shared'), cwd=str(session), defaultOutputRoot=str(session)),
                publication=dict(description='Only prepare publication when requested. Wait for user confirmation.'))
            environment = dict(CODEX_HOME=str(default), CODEX_AUTH='dummy-local-fixture',
                               PATH=str(executable.parent) + os.pathsep + os.environ['PATH'], CODEX_MODEL='', CODEX_BASE_URL='')
            all_events = []
            with patch.dict(os.environ, environment):
                for index, rule in enumerate(['RULE_FIRST', 'RULE_UPDATED']):
                    os.environ['BYCLAW_CODEX_CONNECTION'] = json.dumps(dict(model=f'test-model-{index}',
                        baseUrl=f'http://127.0.0.1:{server.server_port}/' + ('v1' if index == 0 else 'gateway/v1'),
                        apiKey=f'fixture-key-{index}', reasoningEffort='high' if index == 0 else 'low'))
                    manifest['persona'] = rule
                    manifest['messageId'] = f'm{index + 1}'
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        assert runner.run(manifest, f'NATIVE_TURN_{index + 1}: answer only.', by) == 0
                    events = [json.loads(line) for line in output.getvalue().splitlines()]
                    all_events.append(events)
                    assert any(event['type'] == 'turn.completed' for event in events)
                    final = [event['item']['text'] for event in events if event['type'] == 'item.completed' and event['item']['type'] == 'agent_message'][-1]
                    assert json.loads(final) == dict(answer='NATIVE_EXEC_OK', publication=None)
            first = next(event['thread_id'] for event in all_events[0] if event['type'] == 'thread.started')
            second = next(event['thread_id'] for event in all_events[1] if event['type'] == 'thread.started')
            assert first == second, (first, second)
            assert len(requests) == 2, len(requests)
            assert [r['_fixture_auth'] for r in requests] == ['Bearer fixture-key-0', 'Bearer fixture-key-1']
            assert [r['model'] for r in requests] == ['test-model-0', 'test-model-1']
            assert [r['reasoning']['effort'] for r in requests] == ['high', 'low']
            assert [r['_fixture_path'] for r in requests] == ['/v1/responses', '/gateway/v1/responses']
            assert 'fixture-key' not in (home / 'config.toml').read_text()
            assert 'RULE_FIRST' in json.dumps(requests[0])
            assert 'RULE_UPDATED' in json.dumps(requests[1])
            assert 'NATIVE_TURN_1' in json.dumps(requests[1]), 'native resume must retain the previous input'
            assert 'NATIVE_TURN_2' in json.dumps(requests[1])
            assert json.loads((home / 'byclaw-session.json').read_text())['threadId'] == first
    finally:
        server.shutdown()
        server.server_close()
    print('PASS: real Codex 0.167.0 exec/resume, dedicated config, updated employee instructions and structured output (local Responses fixture)')


if __name__ == '__main__':
    main()
