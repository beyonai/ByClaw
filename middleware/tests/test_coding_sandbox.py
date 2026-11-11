"""Codex artifact integrity, archive boundaries and baked-in gateway configuration."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import tomllib
import unittest
from unittest.mock import patch

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HARNESS / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


INSTALLER = load('coding_install', 'install-codex.py')


def archive(path, files):
    with tarfile.open(path, 'w:gz') as target:
        for name, value in files.items():
            data = value.encode()
            entry = tarfile.TarInfo('package/' + name)
            entry.mode = 0o755 if name.endswith(('codex', '.js')) else 0o644
            entry.size = len(data)
            target.addfile(entry, io.BytesIO(data))


class CodingConfigurationTest(unittest.TestCase):
    def test_baked_in_configuration_uses_requested_defaults_and_environment_auth(self):
        content = (HARNESS / 'tool-sandbox/codex.config.toml').read_text(encoding='utf-8')
        config = tomllib.loads(content)
        provider = config['model_providers']['byclaw']
        self.assertEqual(config['model'], 'gpt-6.1-sol')
        self.assertEqual(config['model_provider'], 'byclaw')
        self.assertEqual(provider['base_url'], 'https://api.ikuncode.ai/v1')
        self.assertEqual(provider['env_key'], 'CODEX_AUTH')
        self.assertNotRegex(provider['env_key'].upper(), r'KEY|PASSWORD|SECRET|TOKEN')
        self.assertEqual(provider['wire_api'], 'responses')
        self.assertFalse(provider['requires_openai_auth'])
        self.assertEqual(set(provider), {'name', 'base_url', 'wire_api', 'env_key', 'requires_openai_auth'})


class CodingInstallationTest(unittest.TestCase):
    def test_domestic_source_cannot_redirect_to_an_overseas_or_lookalike_host(self):
        for url in ('https://github.com/payload', 'https://registry.npmjs.org/payload',
                    'https://npmmirror.com.attacker.example/payload',
                    'http://registry.npmmirror.com/payload', 'https://user@npmmirror.com/payload'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                INSTALLER.validate_url(url)
            with self.subTest(redirect=url), self.assertRaises(ValueError):
                INSTALLER.DomesticRedirects().redirect_request(None, None, 302, '', {}, url)
        self.assertEqual(INSTALLER.validate_url('https://cdn.npmmirror.com/payload'),
                         'https://cdn.npmmirror.com/payload')

    def test_integrity_failure_rejects_modified_payload(self):
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / 'payload'
            path.write_bytes(b'original')
            integrity = 'sha512-' + base64.b64encode(hashlib.sha512(b'original').digest()).decode()
            INSTALLER.verify_archive(path, integrity)
            path.write_bytes(b'modified')
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                INSTALLER.verify_archive(path, integrity)

    def test_archive_rejects_traversal_symlinks_and_special_files_before_extraction(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('package/link', tarfile.SYMTYPE), ('package/link', tarfile.LNKTYPE),
                           ('package/pipe', tarfile.FIFOTYPE), ('package/../escape', tarfile.REGTYPE),
                           ('package/..\\escape', tarfile.REGTYPE)):
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                payload = root / 'payload.tgz'
                with tarfile.open(payload, 'w:gz') as target:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/outside'
                    target.addfile(member)
                destination = root / 'destination'
                with self.assertRaises(ValueError):
                    INSTALLER.extract_package(payload, destination, '0.167.0')
                self.assertFalse(destination.exists())

    def test_wrong_package_version_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payload = root / 'payload.tgz'
            archive(payload, {'package.json': json.dumps({'name': '@openai/codex', 'version': '0.0.0'})})
            with self.assertRaisesRegex(ValueError, 'version mismatch'):
                INSTALLER.extract_package(payload, root / 'destination', '0.167.0')
            self.assertFalse((root / 'destination').exists())

    def test_offline_install_preserves_native_package_and_never_fetches(self):
        release = json.loads((HARNESS / 'tool-sandbox/codex.release.json').read_text())
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            for package in release['packages']:
                path = root / package['url'].rsplit('/', 1)[-1]
                files = {'package.json': json.dumps({'name': '@openai/codex', 'version': package['version']})}
                if package['directory'] == 'codex':
                    files['bin/codex.js'] = '#!/usr/bin/env node\n'
                else:
                    files['vendor/x86_64-unknown-linux-musl/bin/codex'] = 'fixture native payload'
                archive(path, files)
                package['integrity'] = 'sha512-' + base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode()
            with patch.object(INSTALLER, 'build_opener', side_effect=AssertionError('unexpected network')):
                # Windows may not allow symlinks; verify their intended target separately.
                with patch.object(Path, 'symlink_to') as link:
                    INSTALLER.install(release, root / 'installed', root)
                link.assert_called_once_with('../node_modules/@openai/codex/bin/codex.js')
            native = root / 'installed/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'
            self.assertEqual(native.read_text(), 'fixture native payload')

    def test_missing_offline_artifact_does_not_fall_back_to_network_or_leave_installation(self):
        release = json.loads((HARNESS / 'tool-sandbox/codex.release.json').read_text())
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            with patch.object(INSTALLER, 'build_opener', side_effect=AssertionError('unexpected network')):
                with self.assertRaises(FileNotFoundError):
                    INSTALLER.install(release, root / 'installed', root)
            self.assertFalse((root / 'installed').exists())


class CodingPackagingTest(unittest.TestCase):
    def test_template_and_image_declare_the_same_contract_and_capabilities(self):
        manifest = json.loads((HARNESS / 'tool-sandbox/coding.capabilities.json').read_text())
        spec = json.loads((HARNESS / 'tool-sandbox/coding.platform.spec.example.json').read_text())
        tool = spec['runtimeOptions']['toolSandbox']
        for key in ('contract', 'purpose'):
            self.assertEqual(manifest[key], tool[key])
        self.assertEqual(manifest['capabilities'], json.loads(tool['capabilities']))
        self.assertEqual(spec['startup']['entrypoint'], ['/usr/local/bin/byclaw-coding-entrypoint', 'tools'])
        self.assertTrue(spec['image'].endswith(':' + manifest['runtimeVersion']))
        self.assertEqual(spec['ports'][0]['instance'], 'ssh')
        self.assertEqual(spec['ports'][0]['exposure'], 'private')
        self.assertEqual(spec['volumes'][0]['mountPath'], '/by')
        config = tomllib.loads((HARNESS / 'tool-sandbox/codex.config.toml').read_text(encoding='utf-8'))
        auth_variable = config['model_providers'][config['model_provider']]['env_key']
        self.assertEqual(spec['env'][auth_variable], '${envVars.' + auth_variable + '}')
        self.assertNotIn('CODEX_BASE_URL', spec['env'])
        self.assertNotIn('CODEX_MODEL', spec['env'])
        self.assertFalse(any('CLAUDE' in key or 'ANTHROPIC' in key for key in spec['env']))

    def test_image_packages_private_defaults_and_uses_original_tool_entrypoint(self):
        dockerfile = (HARNESS / 'Dockerfile.tools.coding').read_text()
        ignore = (HARNESS / 'Dockerfile.tools.coding.dockerignore').read_text()
        source = 'middleware/byclaw-harness/tool-sandbox/codex.config.toml'
        self.assertIn('COPY --chown=byclaw:byclaw --chmod=0600 ' + source
                      + ' /home/byclaw/.codex/config.toml', dockerfile)
        self.assertIn('install -d -m 0700 -o byclaw -g byclaw "${CODEX_HOME}"', dockerfile)
        self.assertIn('!' + source, ignore.splitlines())
        self.assertIn('ENTRYPOINT ["/usr/local/bin/byclaw-coding-entrypoint"]', dockerfile)
        entrypoint = (HARNESS / 'scripts/coding-entrypoint.py').read_text()
        self.assertIn("TOOL_ENTRYPOINT = '/usr/local/bin/byclaw-tool-slim-entrypoint'", entrypoint)
        self.assertIn('os.execv(TOOL_ENTRYPOINT', entrypoint)


if __name__ == '__main__':
    unittest.main()
