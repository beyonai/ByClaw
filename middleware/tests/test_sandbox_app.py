import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'byclaw-harness/scripts/sandbox-app.py'
SPEC = importlib.util.spec_from_file_location('sandbox_app', SCRIPT)
app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(app)


class SandboxAppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        (self.state / 'routes').mkdir()
        (self.state / 'nginx.conf').write_text('test fixture')
        self.state_patch = patch.object(app, 'STATE', self.state)
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)

    def args(self, **changes):
        args = dict(name='example', port=7860, sandbox_id='microvm--cn-beijing--sbx-12345678',
                    domain='apps.example.test', public_base='')
        return argparse.Namespace(**dict(args, **changes))

    def expose(self, args):
        output = io.StringIO()
        with patch.object(app, 'ready', return_value=True), patch.object(app, 'nginx'), patch.object(app, 'wait_route'), redirect_stdout(output):
            app.expose(args)
        return json.loads(output.getvalue())

    def test_platform_id_and_public_ip_entry(self):
        url = app.address('microvm--cn-beijing--sbx-12345678', '', 8082, 'a' * 32,
                          'http://127.0.0.1:8080/sandbox-apps')
        self.assertEqual(url, 'http://127.0.0.1:8080/sandbox-apps/sbx-12345678/a/' + 'a' * 32 + '/')

    def test_reject_bad_identity_and_url(self):
        for sid in ('../secret', 'sbx-12345678/other', 'not-a-sandbox'):
            with self.assertRaises(ValueError):
                app.address(sid, 'apps.example.test', 8082, 'a' * 32)
        for base in ('file:///tmp', 'https://user:password@host/path', 'http://host/?token=x'):
            with self.assertRaises(ValueError):
                app.address('sbx-12345678', '', 8082, 'a' * 32, base)

    def test_same_name_keeps_route_id_and_checks_live_status(self):
        first = self.expose(self.args())
        second = self.expose(self.args(port=7861))
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(first['id']), 32)
        self.assertEqual(app.load_apps()['example']['port'], 7861)
        self.assertIn('127.0.0.1:7861', (self.state / 'routes/example.conf').read_text())

    def test_unready_application_does_not_create_route(self):
        with patch.object(app, 'ready', return_value=False), self.assertRaises(RuntimeError):
            app.expose(self.args())
        self.assertFalse((self.state / 'routes/example.conf').exists())

    def test_nginx_failure_preserves_previous_route(self):
        first = self.expose(self.args())
        path = self.state / 'routes/example.conf'
        previous = path.read_text()
        with patch.object(app, 'ready', return_value=True), patch.object(app, 'nginx', side_effect=RuntimeError('invalid configuration')):
            with self.assertRaises(RuntimeError):
                app.expose(self.args(port=7861))
        self.assertEqual(path.read_text(), previous)
        self.assertEqual(app.load_apps()['example']['id'], first['id'])
        self.assertEqual(app.load_apps()['example']['port'], 7860)

    def test_default_domain_reports_browser_limitation(self):
        result = self.expose(self.args(domain=app.DEFAULT_DOMAIN))
        self.assertFalse(result['browserReady'])
        self.assertIn('notice', result)
        result = self.expose(self.args(public_base='http://127.0.0.1:8080/sandbox-apps'))
        self.assertTrue(result['browserReady'])

    def test_reserved_transport_port_is_rejected(self):
        for port in (8080, 8081, 8082, 2222):
            with patch.object(app, 'ready', return_value=True), self.assertRaises(ValueError):
                app.expose(self.args(port=port))

    def test_route_has_streaming_and_websocket_support(self):
        result = self.expose(self.args())
        config = app.route_config(result)
        self.assertIn('proxy_set_header Upgrade $http_upgrade', config)
        self.assertIn('proxy_buffering off', config)
        self.assertIn('proxy_set_header Host 127.0.0.1:7860', config)
        self.assertNotIn('sub_filter', config)
        self.assertNotIn('easel', config.lower())


if __name__ == '__main__':
    unittest.main()
