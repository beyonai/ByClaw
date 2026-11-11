"""Exercise initialization and explicit migration on real temporary filesystems."""
import errno
import importlib.util
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'byclaw-harness/templates/easel/workspace.py'
spec = importlib.util.spec_from_file_location('easel_entrypoint', SCRIPT)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class EaselWorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.source = base / 'image/source'
        self.root = base / 'personal'
        self.workspace = self.root / 'Easel'
        self.runtime = base / 'image/remotion'
        self.venv = base / 'image/venv'
        for name in entry.REQUIRED:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{}' if name.endswith('.json') else 'source')
        self.remotion = self.source / entry.REMOTION_RELATIVE
        (self.remotion / 'package.json').write_text('{"name":"test"}')
        self.runtime.mkdir(parents=True)
        for name in ('package.json', 'package-lock.json'):
            shutil.copy2(self.remotion / name, self.runtime / name)
        module = self.runtime / 'node_modules/remotion/package.json'
        module.parent.mkdir(parents=True)
        module.write_text('{"version":"4.0.503"}')
        python = self.venv / 'bin/python'
        python.parent.mkdir(parents=True)
        python.touch()
        for key, value in {'SOURCE': self.source, 'WORKSPACE_ROOT': self.root,
                           'WORKSPACE': self.workspace, 'REMOTION_RUNTIME': self.runtime,
                           'VENV': self.venv}.items():
            p = patch.object(entry, key, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(entry, 'owner_ids', return_value=(os.getuid(), os.getgid()))
        p.start()
        self.addCleanup(p.stop)

    @property
    def modules(self):
        return self.workspace / entry.REMOTION_RELATIVE / 'node_modules'

    def legacy_modules(self):
        entry.prepare_workspace()
        self.modules.unlink()
        self.modules.mkdir()
        (self.modules / 'custom.txt').write_text('retain in backup')
        (self.modules / 'nested').mkdir()
        (self.modules / 'nested/link').symlink_to('../custom.txt')

    def test_new_workspace_excludes_dependencies_but_keeps_skills_and_build_assets(self):
        image_modules = self.remotion / 'node_modules'
        image_modules.mkdir()
        for i in range(200):
            (image_modules / f'package-{i}.js').write_text('dependency')
        (self.source / '__pycache__').mkdir()
        (self.source / '__pycache__/code.pyc').touch()
        resource = self.source / 'skills/builtin/example/resource.txt'
        resource.parent.mkdir(parents=True)
        resource.write_text('skill resource')
        entry.prepare_workspace()
        self.assertTrue(self.modules.is_symlink())
        self.assertEqual(self.modules.resolve(), self.runtime / 'node_modules')
        self.assertEqual((self.workspace / '.venv').resolve(), self.venv)
        self.assertFalse((self.workspace / '__pycache__').exists())
        self.assertEqual((self.workspace / resource.relative_to(self.source)).read_text(), 'skill resource')
        self.assertTrue((self.workspace / 'web/frontend/dist/index.html').is_file())
        self.assertLess(len(list(self.workspace.rglob('*'))), 65)
        self.assertFalse(list(self.root.glob('.Easel-init-*')))

    def test_restart_preserves_edits_secrets_outputs_and_custom_config(self):
        entry.prepare_workspace()
        files = {'easel/cli.py': 'user code', '.env': 'private setting',
                 'outputs/result.txt': 'rendered result',
                 'outputs/_harness/config.json': '{"runtime":"custom"}'}
        for name, value in files.items():
            (self.workspace / name).write_text(value)
        entry.prepare_workspace()
        for name, value in files.items():
            self.assertEqual((self.workspace / name).read_text(), value)

    def test_pinned_source_initializes_within_personal_file_budget(self):
        archive = SCRIPT.parent / 'easel-source-5c12e42.tar.gz'
        with tarfile.open(archive) as tar:
            tar.extractall(self.source, filter='data')
        # The image builds this artifact before initialization; source archives omit dist.
        (self.source / 'web/frontend/dist/index.html').write_text('built frontend')
        for name in ('package.json', 'package-lock.json'):
            shutil.copy2(self.remotion / name, self.runtime / name)
        entry.prepare_workspace()
        count = len(list(self.workspace.rglob('*'))) + 1
        self.assertLess(count, 3000)
        self.assertTrue(self.modules.is_symlink())
        self.assertEqual((self.workspace / 'easel/cli.py').read_bytes(),
                         (self.source / 'easel/cli.py').read_bytes())

    def test_copy_failure_never_publishes_partial_source_and_retry_succeeds(self):
        real_copy = shutil.copytree

        def partial(source, target, **kwargs):
            target.mkdir()
            (target / 'pyproject.toml').write_text('partial')
            raise OSError(errno.EDQUOT, 'quota exceeded')

        with patch.object(entry.shutil, 'copytree', side_effect=partial):
            with self.assertRaises(OSError):
                entry.prepare_workspace()
        self.assertFalse(self.workspace.exists())
        self.assertFalse(list(self.root.glob('.Easel-init-*')))
        self.assertIs(entry.shutil.copytree, real_copy)
        entry.prepare_workspace()
        self.assertTrue((self.workspace / 'easel/cli.py').is_file())

    def test_low_inode_budget_stops_before_copying(self):
        self.root.mkdir()
        usage = SimpleNamespace(f_files=10000, f_favail=2, f_blocks=10000,
                                f_bavail=10000, f_frsize=4096)
        with patch.object(entry.os, 'statvfs', return_value=usage):
            with self.assertRaisesRegex(RuntimeError, 'file-count quota'):
                entry.prepare_workspace()
        self.assertFalse(self.workspace.exists())

    def test_existing_partial_source_is_rejected_without_overwrite(self):
        self.workspace.mkdir(parents=True)
        (self.workspace / 'pyproject.toml').write_text('incomplete user tree')
        with self.assertRaisesRegex(RuntimeError, 'incomplete Easel tree'):
            entry.prepare_workspace()
        self.assertEqual((self.workspace / 'pyproject.toml').read_text(), 'incomplete user tree')

    def test_explicit_repair_restores_missing_files_without_overwriting_user_work(self):
        self.workspace.mkdir(parents=True)
        (self.workspace / 'pyproject.toml').write_text('user project')
        (self.workspace / '.env').write_text('user secret')
        modules = self.remotion / 'node_modules'
        modules.mkdir()
        (modules / 'dependency.js').write_text('do not copy')
        entry.repair_workspace()
        self.assertEqual((self.workspace / 'pyproject.toml').read_text(), 'user project')
        self.assertEqual((self.workspace / '.env').read_text(), 'user secret')
        self.assertTrue((self.workspace / 'web/frontend/dist/index.html').is_file())
        self.assertFalse(self.modules.exists())
        entry.prepare_workspace()
        self.assertTrue(self.modules.is_symlink())

    def test_repair_rejects_symlinked_user_directories(self):
        self.workspace.mkdir(parents=True)
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        (self.workspace / 'easel').symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'unsafe workspace parent'):
            entry.repair_workspace()
        self.assertFalse(list(outside.iterdir()))

    def test_existing_dependencies_are_not_automatically_deleted(self):
        self.legacy_modules()
        entry.prepare_workspace()
        self.assertFalse(self.modules.is_symlink())
        self.assertEqual((self.modules / 'custom.txt').read_text(), 'retain in backup')

    def test_explicit_migration_preserves_a_complete_backup_and_source(self):
        self.legacy_modules()
        (self.workspace / '.env').write_text('private setting')
        entry.migrate_dependencies()
        self.assertTrue(self.modules.is_symlink())
        archives = list((self.workspace / '.byclaw-dependency-backups').glob('*.tar.gz'))
        self.assertEqual(len(archives), 1)
        with tarfile.open(archives[0]) as tar:
            self.assertEqual(tar.extractfile('node_modules/custom.txt').read(), b'retain in backup')
            self.assertTrue(tar.getmember('node_modules/nested/link').issym())
        self.assertEqual((self.workspace / '.env').read_text(), 'private setting')
        entry.migrate_dependencies()
        self.assertEqual(len(list(archives[0].parent.glob('*.tar.gz'))), 1)

    def test_backup_quota_failure_leaves_original_dependencies(self):
        self.legacy_modules()
        with patch.object(entry.tarfile, 'open', side_effect=OSError(errno.EDQUOT, 'quota')):
            with self.assertRaises(OSError):
                entry.migrate_dependencies()
        self.assertEqual((self.modules / 'custom.txt').read_text(), 'retain in backup')
        self.assertFalse(list((self.workspace / '.byclaw-dependency-backups').iterdir()))

    def test_missing_image_dependencies_do_not_destroy_legacy_install(self):
        self.legacy_modules()
        shutil.rmtree(self.runtime / 'node_modules')
        with self.assertRaisesRegex(RuntimeError, 'image runtime is missing'):
            entry.migrate_dependencies()
        self.assertEqual((self.modules / 'custom.txt').read_text(), 'retain in backup')

    def test_failed_removal_retains_backup_and_retry_can_finish(self):
        self.legacy_modules()
        with patch.object(entry.shutil, 'rmtree', side_effect=OSError(errno.EIO, 'interrupted')):
            with self.assertRaises(OSError):
                entry.migrate_dependencies()
        backups = list((self.workspace / '.byclaw-dependency-backups').glob('*.tar.gz'))
        self.assertEqual(len(backups), 1)
        self.assertTrue((self.modules / 'custom.txt').is_file())
        entry.migrate_dependencies()
        self.assertTrue(self.modules.is_symlink())
        self.assertTrue(backups[0].is_file())

    def test_custom_manifests_and_dependencies_are_preserved(self):
        self.legacy_modules()
        (self.workspace / entry.REMOTION_RELATIVE / 'package.json').write_text('{"custom":true}')
        entry.prepare_workspace()
        with self.assertRaisesRegex(RuntimeError, 'custom Remotion manifests'):
            entry.migrate_dependencies()
        self.assertEqual((self.modules / 'custom.txt').read_text(), 'retain in backup')

    def test_workspace_and_dependency_parent_symlinks_are_not_followed(self):
        self.root.mkdir()
        elsewhere = Path(self.temporary.name) / 'elsewhere'
        elsewhere.mkdir()
        self.workspace.symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symlink workspace'):
            entry.prepare_workspace()
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.workspace.unlink()
        entry.prepare_workspace()
        shutil.rmtree(self.workspace / 'outputs')
        (self.workspace / 'outputs').symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'unsafe workspace parent'):
            entry.prepare_workspace()
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_application_environment_preserves_codex_auth_home_and_model_overrides(self):
        environment = {'PATH': '/usr/bin', 'CODEX_HOME': '/by/.sessions/s1/executors/1001/codex-home',
                       'CODEX_AUTH': 'test-only', 'CODEX_MODEL': 'chosen-model',
                       'PLAYWRIGHT_BROWSERS_PATH': '/ms-playwright',
                       'BYCLAW_BROWSER_EXECUTABLE_PATH': '/usr/local/bin/byclaw-playwright-chromium',
                       'BYCLAW_APP_PUBLIC_BASE': 'https://apps.example.test/sandbox-apps'}
        result = entry.runtime_environment(environment)
        for key in ('CODEX_HOME', 'CODEX_AUTH', 'CODEX_MODEL'):
            self.assertEqual(result[key], environment[key])
        self.assertEqual(result['EASEL_EXTRA_ORIGINS'], 'https://apps.example.test')
        self.assertEqual(environment['PATH'], '/usr/bin')
        self.assertNotIn('EASEL_PROJECT_ROOT', environment)
        self.assertEqual(result['PLAYWRIGHT_BROWSERS_PATH'], '/opt/easel-runtime/playwright')
        self.assertEqual(environment['PLAYWRIGHT_BROWSERS_PATH'], '/ms-playwright')
        self.assertEqual(result['BYCLAW_BROWSER_EXECUTABLE_PATH'], environment['BYCLAW_BROWSER_EXECUTABLE_PATH'])

    def test_explicit_init_does_not_create_a_competing_codex_home(self):
        entry.main(['init'])
        self.assertFalse((self.root / '.codex').exists())

    def test_run_uses_template_environment_only_for_child_and_does_not_reinitialize(self):
        entry.prepare_workspace()
        with (patch.object(entry, 'prepare_workspace', side_effect=AssertionError('implicit init')),
             patch.object(entry.os, 'chdir') as chdir,
             patch.object(entry.os, 'execve') as execute):
            entry.main(['run', 'web', '--port', '7860'])
        chdir.assert_called_once_with(self.workspace)
        self.assertEqual(execute.call_args.args[1], [str(self.venv / 'bin/easel'), 'web', '--port', '7860'])


if __name__ == '__main__':
    unittest.main()
