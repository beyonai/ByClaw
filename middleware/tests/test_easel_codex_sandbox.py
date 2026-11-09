"""Static contract checks for the Easel + Codex ByClaw tool sandbox."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'
TOOL_SANDBOX = HARNESS / 'tool-sandbox'
SOURCE_COMMIT = '5c12e42e9019d276368130b52385b770749ffa6f'


class EaselCodexSandboxContractTest(unittest.TestCase):
    def test_market_manifest_and_image_handshake_match(self) -> None:
        manifest = json.loads((TOOL_SANDBOX / 'easel-codex.capabilities.json').read_text())
        example = json.loads((TOOL_SANDBOX / 'easel-codex.spec.example.json').read_text())
        market = example['runtimeOptions']['toolSandbox']
        self.assertEqual(manifest['purpose'], 'easel-codex')
        self.assertEqual(market['purpose'], manifest['purpose'])
        self.assertEqual(market['templateKey'], manifest['purpose'])
        self.assertEqual(json.loads(market['capabilities']), manifest['capabilities'])
        self.assertEqual(manifest['operations'], json.loads(market['operations']))
        self.assertEqual(
            example['startup']['entrypoint'],
            ['/usr/local/bin/byclaw-easel-codex-entrypoint', 'tools'],
        )
        self.assertEqual(example['env']['EASEL_AGENT_RUNTIME'], 'codex')
        self.assertEqual(example['env']['CODEX_HOME'], '/by/.codex')
        self.assertNotIn(5432, [port['port'] for port in example['ports']])
        self.assertNotIn(7860, [port['port'] for port in example['ports']])
        self.assertFalse(any(
            volume['mountPath'].startswith('/var/lib/postgresql')
            for volume in example['volumes']
        ))

    def test_source_archive_is_pinned_and_checksummed(self) -> None:
        metadata = json.loads((TOOL_SANDBOX / 'easel-codex.source.json').read_text())
        archive = TOOL_SANDBOX / metadata['archive']
        self.assertEqual(metadata['commit'], SOURCE_COMMIT)
        self.assertGreater(archive.stat().st_size, 1_000_000)
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), metadata['sha256'])

    def test_dockerfile_uses_narrow_domestic_build(self) -> None:
        dockerfile = (HARNESS / 'Dockerfile.tools.easel-codex').read_text()
        self.assertIn(
            '192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser',
            dockerfile,
        )
        self.assertIn('test "${TARGETARCH}" = amd64', dockerfile)
        self.assertIn('registry.npmmirror.com', dockerfile)
        self.assertIn('pypi.tuna.tsinghua.edu.cn', dockerfile)
        self.assertIn('mirrors.aliyun.com/pytorch-wheels/cpu', dockerfile)
        self.assertIn('npmmirror.com/mirrors/playwright', dockerfile)
        self.assertIn('sha256sum -c easel-source-5c12e42.tar.gz.sha256', dockerfile)
        self.assertNotIn('git clone', dockerfile)
        self.assertNotIn('download.pytorch.org', dockerfile)
        self.assertNotIn('registry.npmjs.org', dockerfile)
        self.assertNotIn('openclaw', dockerfile.lower())

    def test_docker_context_excludes_unrelated_repository(self) -> None:
        ignore = (HARNESS / 'Dockerfile.tools.easel-codex.dockerignore').read_text()
        self.assertTrue(ignore.startswith('**\n'))
        self.assertNotIn('!middleware/byclaw-harness/**', ignore)
        self.assertIn('!middleware/byclaw-harness/scripts/easel-codex-entrypoint.py', ignore)
        self.assertIn('!middleware/byclaw-harness/tool-sandbox/assets/easel-source-5c12e42.tar.gz', ignore)


if __name__ == '__main__':
    unittest.main()
