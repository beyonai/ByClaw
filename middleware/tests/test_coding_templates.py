"""Coding gateway startup, template separation and Codex configuration compatibility."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HARNESS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


entry = load('coding_entry', 'scripts/coding-entrypoint.py')


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

    def test_image_has_no_application_source_environment_or_initializer(self):
        dockerfile = (HARNESS / 'Dockerfile.tools.coding').read_text()
        self.assertEqual(dockerfile.count('FROM '), 1)
        self.assertIn('AS tools-coding', dockerfile)
        self.assertIn('byclaw-harness:D0.6.0_browser', dockerfile)
        self.assertIn('install-codex.py --release', dockerfile)
        self.assertIn('/home/byclaw/.codex/config.toml', dockerfile)
        for value in ('easel', 'sandbox-template', 'templates/', 'ffmpeg', 'remotion'):
            self.assertNotIn(value, dockerfile.lower())
        ignore = (HARNESS / 'Dockerfile.tools.coding.dockerignore').read_text()
        self.assertNotIn('!middleware/byclaw-harness/templates/', ignore)
        self.assertNotIn('!middleware/byclaw-harness/**', ignore)


if __name__ == '__main__':
    unittest.main()
