"""Shared Docker build inputs and runtime installation contracts."""
from pathlib import Path
import shlex
import unittest

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / 'middleware/builtin'


def copies(path):
    for line in path.read_text().replace('\\\n', ' ').splitlines():
        if line.startswith('COPY ') and '--from=' not in line:
            yield [part for part in shlex.split(line)[1:] if not part.startswith('--')]


class SharedBuiltinTest(unittest.TestCase):
    def test_all_docker_copy_sources_exist_in_repository_context(self):
        for module in ('openclaw', 'byclaw-harness'):
            for dockerfile in (ROOT / 'middleware' / module).glob('Dockerfile*'):
                if dockerfile.name.endswith('.dockerignore'):
                    continue
                for parts in copies(dockerfile):
                    for source in parts[:-1]:
                        with self.subTest(dockerfile=dockerfile.name, source=source):
                            self.assertTrue(list(ROOT.glob(source)), source)
                            self.assertNotIn('middleware/openclaw/skills/', source)
                            self.assertNotIn('middleware/byclaw-harness/builtin/', source)

    def test_harness_runtime_destinations_and_ownership(self):
        for name in ('Dockerfile', 'Dockerfile.extensions'):
            dockerfile = ROOT / 'middleware/byclaw-harness' / name
            text = dockerfile.read_text()
            self.assertIn('COPY --chown=byclaw:byclaw middleware/builtin/ /opt/byclaw/builtin/', text)
            self.assertIn('COPY --chown=byclaw:byclaw middleware/builtin/skills/ /opt/byclaw/dsh-managed/skills/', text)
            self.assertIn('BYCLAW_RUNTIME_HOME=/opt/byclaw/builtin', text)
            self.assertIn('!middleware/builtin/**', dockerfile.with_name(name + '.dockerignore').read_text())

    def test_openclaw_installation_paths(self):
        path = ROOT / 'middleware/openclaw/Dockerfile'
        text = path.read_text()
        self.assertIn('COPY middleware/builtin/skills/ /app/skills/', text)
        self.assertIn('COPY middleware/builtin/runtime-tools/ /usr/local/lib/byclaw/runtime-tools/', text)
        for name in ('callcli', 'dbcli', 'kbcli', 'groksearchcli'):
            self.assertIn(f'COPY middleware/builtin/python-clis/{name}/src/ /tmp/byclaw-python-clis/{name}/src/', text)
            self.assertTrue((SHARED / 'python-clis' / name / 'pyproject.toml').is_file())

    def test_compatibility_paths_share_the_same_resources(self):
        self.assertEqual((ROOT / 'middleware/byclaw-harness/builtin').resolve(), SHARED)
        for name in ('skills', 'runtime-tools', 'cli', 'skills-registry.json'):
            self.assertEqual((ROOT / 'middleware/openclaw' / name).resolve(), SHARED / name)
        for name in ('callcli', 'dbcli', 'kbcli', 'groksearchcli'):
            self.assertEqual((ROOT / 'middleware/openclaw' / name).resolve(), SHARED / 'python-clis' / name)

    def test_shared_resource_changes_trigger_openclaw_builds(self):
        text = (ROOT / '.github/workflows/docker-build-middleware.yml').read_text()
        self.assertIn('openclaw:\n              - "middleware/builtin/**"', text)

    def test_data_root_is_configured_in_final_image_stage(self):
        for module, names in {
            'byclaw-harness': ('Dockerfile', 'Dockerfile.extensions'),
            'openclaw': ('Dockerfile', 'Dockerfile.byclaw', 'Dockerfile.simple', 'Dockerfile.cubesandbox'),
        }.items():
            for name in names:
                text = (ROOT / 'middleware' / module / name).read_text()
                self.assertIn('ENV BYCLAW_DATA_ROOT=/by', text.rsplit('\nFROM ', 1)[-1])

    def test_shared_scripts_do_not_embed_container_resource_locations(self):
        for path in SHARED.rglob('*'):
            if path.suffix not in ('.py', '.js', '.mjs', '.sh'):
                continue
            if 'tests' in path.parts or path.name.startswith('test_') or '.test.' in path.name:
                continue
            for prefix in ('/app/skills/', '/opt/byclaw/', '/Users/', '/by/'):
                with self.subTest(path=str(path.relative_to(SHARED)), prefix=prefix):
                    self.assertNotIn("'" + prefix, path.read_text())
                    self.assertNotIn('"' + prefix, path.read_text())


if __name__ == '__main__':
    unittest.main()
