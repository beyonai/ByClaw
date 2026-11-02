#!/usr/bin/env python3
"""Offline launcher checks: gating, lock refusal and inherited ownership."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('managed', Path(__file__).with_name('byclaw-bycli-managed.py'))
managed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(managed)


class LauncherTest(unittest.TestCase):
    def test_disabled_and_health_commands_keep_original_execution(self):
        for flag, args in [('false', ['site', 'read']), ('true', ['doctor']), ('ON', ['daemon', 'start'])]:
            with self.subTest(flag=flag, args=args), patch.dict(os.environ, {'BYCLAW_BROWSER_JEV_ENABLED': flag}, clear=True), \
                 patch.object(managed.sys, 'argv', ['bycli', *args]), \
                 patch.object(Path, 'read_text', return_value=json.dumps({'bin': {'bycli': 'dist/cli.js'}})), \
                 patch.object(managed.os, 'execv', side_effect=SystemExit(0)) as execute:
                with self.assertRaises(SystemExit):
                    managed.main()
                self.assertEqual(execute.call_args.args[1][2:], args)

    def test_enabled_command_holds_lock_in_child(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {'BYCLAW_BROWSER_JEV_ENABLED': 'yes', 'BYCLAW_BROWSER_AUTOMATION_LOCK': f'{directory}/lock'}, clear=True), \
             patch.object(managed.sys, 'argv', ['bycli', 'site', 'read']), \
             patch.object(Path, 'read_text', return_value=json.dumps({'bin': 'dist/cli.js'})), \
             patch.object(managed.signal, 'signal'), \
             patch.object(managed.subprocess, 'Popen', return_value=Mock(wait=lambda: 0)) as spawn:
            self.assertEqual(managed.main(), 0)
            self.assertEqual(len(spawn.call_args.kwargs['pass_fds']), 1)
            self.assertEqual(Path(f'{directory}/lock').stat().st_mode & 0o777, 0o600)

    def test_busy_command_never_dispatches(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {'BYCLAW_BROWSER_JEV_ENABLED': 'true', 'BYCLAW_BROWSER_AUTOMATION_LOCK': f'{directory}/lock'}, clear=True), \
             patch.object(managed.sys, 'argv', ['bycli', 'site', 'write']), \
             patch.object(Path, 'read_text', return_value=json.dumps({'bin': 'dist/cli.js'})), \
             patch.object(managed.time, 'monotonic', side_effect=[0, 11]), \
             patch.object(managed.fcntl, 'flock', side_effect=BlockingIOError), \
             patch.object(managed.subprocess, 'Popen') as spawn:
            self.assertEqual(managed.main(), 75)
            spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
