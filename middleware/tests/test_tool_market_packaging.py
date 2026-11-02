"""Source-only packaging and fail-closed archive installation contracts."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'byclaw-harness/scripts'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class ToolMarketPackagingTest(unittest.TestCase):
    def test_stage_copies_source_but_never_local_compiled_output_or_dependencies(self):
        pack = module('market_pack', 'pack-tool-market-plugin.py')
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); source = root / 'source'; stage = root / 'stage'
            for directory in ('src', 'lib', 'node_modules', 'scripts/node_modules'):
                (source / directory).mkdir(parents=True, exist_ok=True)
            (source / 'package.json').write_text(json.dumps({'name': '@byclaw/dsh-tool-env'}))
            (source / 'tsconfig.json').write_text('{}')
            (source / 'cordis.patch.yml').write_text('plugins: {}')
            (source / 'src/index.ts').write_text('export const value = 1')
            (source / 'lib/old.js').write_text('old')
            (source / 'scripts/ws-proxy.mjs').write_text('export {}')
            (source / 'scripts/node_modules/private').write_text('never-copy')
            (source / '.env').write_text('fixture-secret')
            pack.stage_source(source, stage)
            self.assertTrue((stage / 'src/index.ts').is_file())
            self.assertFalse((stage / 'lib').exists())
            self.assertFalse((stage / 'node_modules').exists())
            self.assertFalse((stage / 'scripts/node_modules').exists())
            self.assertFalse((stage / '.env').exists())

    def test_installer_rejects_unsafe_archive_members_before_mutation(self):
        installer = module('market_install', 'install-tool-market-overlay.py')
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('lib/link', tarfile.SYMTYPE), ('lib/fifo', tarfile.FIFOTYPE),
                           ('.env', tarfile.REGTYPE), ('scripts/node_modules/key', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as raw:
                archive = Path(raw) / 'input.tgz'
                with tarfile.open(archive, 'w:gz') as tar:
                    member = tarfile.TarInfo(name); member.type = kind; member.linkname = '/tmp'
                    if kind == tarfile.REGTYPE:
                        member.size = 1; tar.addfile(member, io.BytesIO(b'x'))
                    else:
                        tar.addfile(member)
                with self.assertRaises(ValueError):
                    installer.validate_archive(archive)

    def test_installer_replaces_old_payload_and_preserves_dependency_closure(self):
        installer = module('market_install_clean', 'install-tool-market-overlay.py')
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); package = root / 'package'; package.mkdir()
            (package / 'lib').mkdir(); (package / 'lib/stale.js').write_text('old')
            (package / 'node_modules').mkdir(); (package / 'node_modules/keep').write_text('dependency')
            archive = root / 'input.tgz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name, body in {'package.json': '{"name":"@byclaw/dsh-tool-env"}', 'lib/index.js': 'new'}.items():
                    b = body.encode(); member = tarfile.TarInfo(name); member.size = len(b); tar.addfile(member, io.BytesIO(b))
            installer.replace_payload(package, archive)
            self.assertFalse((package / 'lib/stale.js').exists())
            self.assertEqual((package / 'lib/index.js').read_text(), 'new')
            self.assertEqual((package / 'node_modules/keep').read_text(), 'dependency')

    def test_missing_declared_dependency_fails_without_installing_any_sdk(self):
        pack = module('market_pack_missing', 'pack-tool-market-plugin.py')
        import subprocess
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); stage = root / 'stage'; stage.mkdir()
            (stage / 'package.json').write_text(json.dumps({'name': '@byclaw/dsh-tool-env',
                'dependencies': {'@byclaw/fixture-missing-sdk-package': 'workspace:*'}}))
            dependency = root / 'profile/node_modules/@byclaw/dsh-tool-env'; dependency.mkdir(parents=True)
            (dependency / 'package.json').write_text('{"name":"@byclaw/dsh-tool-env"}')
            with self.assertRaises(subprocess.CalledProcessError):
                pack.link_installed_dependencies(stage, dependency, root / 'framework')
            self.assertFalse((stage / 'node_modules').exists())

    def test_installer_never_extracts_through_an_old_payload_symlink(self):
        installer = module('market_install_link', 'install-tool-market-overlay.py')
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); package = root / 'package'; package.mkdir()
            outside = root / 'outside'; outside.mkdir(); (outside / 'unchanged').write_text('fixture')
            (package / 'lib').symlink_to(outside)
            archive = root / 'input.tgz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name, body in {'package.json': '{"name":"@byclaw/dsh-tool-env"}', 'lib/index.js': 'new'}.items():
                    data = body.encode(); entry = tarfile.TarInfo(name); entry.size = len(data); tar.addfile(entry, io.BytesIO(data))
            installer.replace_payload(package, archive)
            self.assertFalse((outside / 'index.js').exists())
            self.assertEqual((outside / 'unchanged').read_text(), 'fixture')
            self.assertFalse((package / 'lib').is_symlink())

    def test_overlay_builds_source_in_same_base_and_never_copies_output_archive(self):
        source = (SCRIPTS.parent / 'Dockerfile.tool-market-host').read_text()
        self.assertIn('FROM ${HARNESS_IMAGE} AS plugin-builder', source)
        self.assertIn('pack-tool-market-plugin.py', source)
        self.assertIn('COPY --from=plugin-builder', source)
        self.assertNotIn('COPY output/', source)
        self.assertNotIn('npm install', source)
        self.assertNotIn('pnpm install', source)


if __name__ == '__main__':
    unittest.main()
