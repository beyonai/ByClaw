"""Coding gateway startup, template separation and Codex configuration compatibility."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HARNESS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


entry = load('coding_entry', 'scripts/coding-entrypoint.py')
templates = load('coding_templates', 'scripts/sandbox-template.py')


class CodingTemplateTests(unittest.TestCase):
    def test_startup_only_prepares_gateway_and_preserves_environment(self):
        with (patch.dict(os.environ, {'CODEX_HOME': '/by/.sessions/s/executors/e/codex-home',
                                     'CODEX_AUTH': 'test-only'}),
              patch.object(entry.os, 'geteuid', return_value=0),
              patch.object(entry.subprocess, 'run') as run,
              patch.object(entry.os, 'execv') as execute):
            before = dict(os.environ)
            entry.main(['tools'])
            self.assertEqual(dict(os.environ), before)
        run.assert_called_once_with(['/usr/local/bin/sandbox-app', 'init'], check=True)
        execute.assert_called_once_with(entry.TOOL_ENTRYPOINT, [entry.TOOL_ENTRYPOINT, 'tools'])

    def test_gateway_failure_prevents_false_readiness(self):
        with (patch.object(entry.os, 'geteuid', return_value=0),
              patch.object(entry.subprocess, 'run', side_effect=RuntimeError('gateway failed')),
              patch.object(entry.os, 'execv') as execute):
            with self.assertRaises(RuntimeError):
                entry.main(['tools'])
            execute.assert_not_called()

    def test_other_arguments_retain_original_entrypoint_handling(self):
        with patch.object(entry.subprocess, 'run') as run, patch.object(entry.os, 'execv') as execute:
            entry.main(['--sshd'])
            run.assert_not_called()
            execute.assert_called_once_with(entry.TOOL_ENTRYPOINT, [entry.TOOL_ENTRYPOINT, '--sshd'])

    def test_template_uses_pinned_source_and_does_not_declare_a_new_sandbox_purpose(self):
        root = HARNESS / 'templates/easel'
        metadata = json.loads((root / 'source.json').read_text())
        manifest = json.loads((root / 'template.json').read_text())
        self.assertEqual(hashlib.sha256((root / metadata['archive']).read_bytes()).hexdigest(), metadata['sha256'])
        self.assertEqual(manifest['sourceRevision'], metadata['commit'])
        self.assertNotIn('purpose', manifest)
        self.assertEqual(manifest['start'][:3], ['sandbox-template', 'run', 'easel'])

    def test_template_command_dispatch_is_explicit_and_rejects_unknown_identifiers(self):
        with (patch.object(templates, 'TEMPLATES', HARNESS / 'templates'),
              patch.object(templates.subprocess, 'call', return_value=0) as call):
            templates.main(['init', 'easel'])
            self.assertEqual(call.call_args.args[0][-2:], [str(HARNESS / 'templates/easel/workspace.py'), 'init'])
            templates.main(['run', 'easel', '--', 'web', '--port', '7860'])
            self.assertEqual(call.call_args.args[0][-4:], ['run', 'web', '--port', '7860'])
            with self.assertRaises(ValueError):
                templates.template('../secret')
            with self.assertRaises(FileNotFoundError):
                templates.template('unknown')

    def test_empty_core_has_no_template_side_effects(self):
        with tempfile.TemporaryDirectory() as raw, patch.object(templates, 'TEMPLATES', Path(raw)):
            self.assertEqual(templates.main(['list']), 0)
            self.assertEqual(list(Path(raw).iterdir()), [])

    def test_core_does_not_install_easel_or_replace_codex_and_template_environment_is_separate(self):
        dockerfile = (HARNESS / 'Dockerfile.tools.coding').read_text()
        core, bundled = dockerfile.split('FROM coding-core AS tools-coding')
        self.assertNotIn('templates/easel', core)
        self.assertIn('install-codex.py --release', core)
        self.assertIn('/home/byclaw/.codex/config.toml', core)
        self.assertIn('templates/easel/install.sh', bundled)
        installer = (HARNESS / 'templates/easel/install.sh').read_text()
        self.assertNotIn('@openai/codex', installer)
        self.assertNotIn('CODEX_HOME=', installer)
        self.assertNotIn('session-env', installer)
        self.assertIn('PLAYWRIGHT_BROWSERS_PATH=/opt/easel-runtime/playwright', installer)
        self.assertNotIn('/ms-playwright', installer)
        self.assertNotIn('ln -sfn "$chromium_path"', installer)

    def test_template_build_inputs_are_admitted_without_copying_developer_state(self):
        ignore = (HARNESS / 'Dockerfile.tools.coding.dockerignore').read_text().splitlines()
        for path in ('template.json', 'README.md', 'source.json', 'workspace.py', 'install.sh', 'preview.conf',
                     'easel-source-5c12e42.tar.gz', 'easel-source-5c12e42.tar.gz.sha256'):
            self.assertIn('!middleware/byclaw-harness/templates/easel/' + path, ignore)
        self.assertNotIn('!middleware/byclaw-harness/templates/easel/**', ignore)
        self.assertNotIn('!middleware/byclaw-harness/**', ignore)


if __name__ == '__main__':
    unittest.main()
