"""Exercise real deployment generators without Docker, credentials or live services.

NGINX_DEPLOY_TEST_ROOT and NGINX_GENERATOR_UNDER_TEST allow the same cases to verify
the middleware deployment overlay, which intentionally maintains its own config.
"""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(os.environ.get('NGINX_DEPLOY_TEST_ROOT', Path(__file__).resolve().parents[2]))
GENERATOR = Path(os.environ.get('NGINX_GENERATOR_UNDER_TEST', ROOT / 'deploy/standalone/gen-nginx-conf.sh'))


class NginxAppPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'deploy/config'
        (self.config / 'ssl').mkdir(parents=True)
        (self.config / 'ssl/localhost.key').write_text('fixture')
        (self.config / 'ssl/localhost.crt').write_text('fixture')
        self.standalone = self.root / 'deploy/standalone'
        self.standalone.mkdir()
        shutil.copy2(GENERATOR, self.standalone / 'gen-nginx-conf.sh')
        for name in ('nginx-standalone.conf.tpl', 'nginx-app-preview.conf.tpl', 'render-app-preview.sh'):
            shutil.copy2(ROOT / 'deploy/config' / name, self.config / name)
        self.output = self.config / 'nginx-standalone.conf'
        self.output.write_text('previous configuration\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()

    def run_generator(self, values=None, *, podman=False, expected=0, template=None):
        if template is not None:
            (self.root / 'nginx-standalone.conf.tpl').write_text(template)
        (self.root / '.env').write_text(''.join(key + '=' + shlex.quote(value) + '\n'
                                              for key, value in (values or {}).items()))
        if podman:
            for name, content in {'uname': '#!/bin/sh\necho Darwin\n',
                                  'podman': '#!/bin/sh\necho 10.89.0.1\n'}.items():
                p = self.bin / name
                p.write_text(content)
                p.chmod(0o755)
        result = subprocess.run(['sh', str(self.standalone / 'gen-nginx-conf.sh')],
                                env={'PATH': str(self.bin) + ':/usr/bin:/bin', 'HOME': str(self.root)},
                                text=True, capture_output=True, timeout=15)
        if expected == 0:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.output.read_text(), 'previous configuration\n')
        return self.output.read_text()

    def test_default_is_closed_and_does_not_retarget_cloud_traffic(self):
        text = self.run_generator()
        self.assertIn('location /sandbox-apps/ { return 404; }', text)
        self.assertNotIn('$app_upstream', text)
        self.assertNotIn('{{', text)

    def test_enabled_ingress_has_its_own_dns_in_every_platform_mode(self):
        for mode in ('docker', 'cluster', 'podman'):
            with self.subTest(mode=mode):
                values = {'NGINX_APP_PREVIEW_DOMAIN': 'sandbox.example.test'}
                if mode == 'cluster':
                    values['BE_CLUSTER'] = 'be-one:8086,be-two:8086'
                text = self.run_generator(values, podman=mode == 'podman')
                preview = text.split('location ~ "^/sandbox-apps/', 1)[1]
                self.assertIn('resolver ' + ('10.89.0.1' if mode == 'podman' else '127.0.0.11') + ' valid=10s;', preview)
                self.assertIn('8082-${app_sandbox}.sandbox.example.test', preview)
                self.assertIn('$app_path$is_args$args', preview)
                self.assertIn('proxy_ssl_verify on;', preview)
                self.assertIn('proxy_set_header Authorization "";', preview)
                self.assertIn('proxy_hide_header Content-Disposition;', preview)
                self.assertNotIn('{{', text)

    def test_environment_can_override_port_and_reachable_resolver(self):
        text = self.run_generator({'NGINX_APP_PREVIEW_DOMAIN': 'other.example.test',
                                   'NGINX_APP_PREVIEW_PORT': '9082', 'NGINX_APP_PREVIEW_DNS': '10.0.0.53'})
        self.assertIn('9082-${app_sandbox}.other.example.test', text)
        self.assertIn('resolver 10.0.0.53 valid=10s;', text)
        self.assertNotIn('cn-beijing.sandbox.aliyuncs.com', text)

    def test_invalid_configuration_never_overwrites_previous_config(self):
        bad_values = {
            'NGINX_APP_PREVIEW_DOMAIN': ['https://host.test', 'host.test/path', 'user@host.test',
                                         'host..test', 'host.test;return 200', 'host.test\nreturn 200;', '$host.test'],
            'NGINX_APP_PREVIEW_PORT': ['80', '65536', '8082;return 200', '1' * 30],
            'NGINX_APP_PREVIEW_DNS': ['999.0.0.1', '127.0.0.11;return 200', '127.0.0.11\n', 'dns.example.test'],
        }
        for key, values in bad_values.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    self.output.write_text('previous configuration\n')
                    self.run_generator({'NGINX_APP_PREVIEW_DOMAIN': 'sandbox.example.test', key: value}, expected=1)

    def test_environment_template_retains_priority_and_renders_preview(self):
        text = self.run_generator({'NGINX_APP_PREVIEW_DOMAIN': 'sandbox.example.test'},
                                  template='# environment-specific\n{{APP_PREVIEW_BLOCK}}\n')
        self.assertTrue(text.startswith('# environment-specific\n'))
        self.assertIn('8082-${app_sandbox}.sandbox.example.test', text)
        self.assertNotIn('{{', text)

    def test_rerender_replaces_settings_instead_of_accumulating_routes(self):
        self.run_generator({'NGINX_APP_PREVIEW_DOMAIN': 'first.example.test'})
        text = self.run_generator({'NGINX_APP_PREVIEW_DOMAIN': 'second.example.test'})
        self.assertNotIn('first.example.test', text)
        self.assertEqual(text.count('set $app_upstream '), 1)
        self.assertNotIn('$app_upstream', self.run_generator())


if __name__ == '__main__':
    unittest.main()
