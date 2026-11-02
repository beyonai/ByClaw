"""Build-source defaults must fail closed rather than silently go overseas."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / 'middleware/byclaw-harness'


class ToolSandboxDomesticSourcesTest(unittest.TestCase):
    def test_python_bootstrap_requires_explicit_controlled_image(self):
        source = (HARNESS / 'Dockerfile.base').read_text()
        self.assertRegex(source, r'(?m)^ARG PYTHON_IMAGE\s*$')
        self.assertIn('FROM ${PYTHON_IMAGE} AS dsh-base', source)
        self.assertNotIn('FROM python:', source)

    def test_unverified_mirrors_have_no_default_or_overseas_fallback(self):
        source = (HARNESS / 'Dockerfile.base').read_text()
        for name in ('RTK_DOWNLOAD_BASE', 'NVM_SOURCE_BASE', 'DSH_REPOSITORY'):
            self.assertRegex(source, rf'(?m)^ARG {name}\s*$', name)
            self.assertIn('${' + name + ':?', source, name)
        self.assertNotRegex(source, r'(?m)^ARG \w+=https?://(?:github\.com|githubfast\.com|cdn\.jsdelivr\.net)')
        self.assertNotIn('--registry=https://registry.npmjs.org', source)
        self.assertIn('--registry="${NPM_CONFIG_REGISTRY}"', source)

    def test_no_implicit_dockerhub_frontend_download(self):
        for name in ('Dockerfile.base', 'Dockerfile', 'Dockerfile.extensions', 'Dockerfile.base_slim', 'Dockerfile.slim', 'Dockerfile.tool_slim'):
            self.assertNotRegex((HARNESS / name).read_text(), r'(?m)^#\s*syntax=docker/dockerfile')

    def test_derived_image_base_is_a_required_input(self):
        for name, variable in (('Dockerfile.tools.browser', 'TOOLS_IMAGE'),
                               ('Dockerfile.tools.media', 'TOOLS_IMAGE'),
                               ('Dockerfile.tool-market-host', 'HARNESS_IMAGE')):
            self.assertRegex((HARNESS / name).read_text(), rf'(?m)^ARG {variable}\s*$', name)

    def test_external_images_preserve_domestic_defaults_without_implicit_dockerhub(self):
        expected = {
            'Dockerfile': 'BASE_IMAGE',
            'Dockerfile.extensions': 'BASE_IMAGE',
            'Dockerfile.slim': 'BASE_IMAGE',
            'Dockerfile.base': 'PYTHON_IMAGE',
            'Dockerfile.base_slim': 'RUNTIME_IMAGE',
            'Dockerfile.tools': 'HARNESS_IMAGE',
            'Dockerfile.tool_slim': 'HARNESS_IMAGE',
            'Dockerfile.tools.browser': 'TOOLS_IMAGE',
            'Dockerfile.tools.media': 'TOOLS_IMAGE',
            'Dockerfile.tool-market-host': 'HARNESS_IMAGE',
        }
        for name, variable in expected.items():
            source = (HARNESS / name).read_text()
            defaults = re.findall(rf'(?m)^ARG {variable}=(\S+)$', source)
            if name in {'Dockerfile', 'Dockerfile.extensions', 'Dockerfile.slim', 'Dockerfile.tools', 'Dockerfile.tool_slim'}:
                self.assertEqual(len(defaults), 1, name)
                self.assertTrue(defaults[0].startswith('192.168.0.81:8080/byclaw/'), name)
            else:
                self.assertRegex(source, rf'(?m)^ARG {variable}\s*$', name)
                self.assertFalse(defaults, name)
            stages = set()
            for line in source.splitlines():
                match = re.match(r'FROM (\S+)(?: AS (\S+))?$', line, re.I)
                if not match:
                    continue
                image, stage = match.groups()
                self.assertTrue(image == 'scratch' or image in stages or image == '${' + variable + '}',
                                f'{name}: implicit external image {image}')
                if stage:
                    stages.add(stage)

    def test_slim_variant_has_no_overseas_bootstrap_defaults(self):
        source = (HARNESS / 'Dockerfile.base_slim').read_text()
        self.assertRegex(source, r'(?m)^ARG RUNTIME_IMAGE\s*$')
        for name in ('NVM_SOURCE_BASE', 'DSH_REPOSITORY'):
            self.assertRegex(source, rf'(?m)^ARG {name}\s*$')
            self.assertIn('${' + name + ':?', source)
        self.assertNotIn('--registry=https://registry.npmjs.org', source)
        tools = (HARNESS / 'Dockerfile.tool_slim').read_text()
        self.assertRegex(tools, r'(?m)^ARG RTK_DOWNLOAD_BASE\s*$')
        self.assertIn('${RTK_DOWNLOAD_BASE:?', tools)
        self.assertIn('configure-cn-sources.sh', tools)

    def test_maven_central_uses_a_domestic_global_mirror(self):
        script = (HARNESS / 'tool-sandbox/configure-cn-sources.sh').read_text()
        self.assertIn('https://maven.aliyun.com/repository/public', script)
        self.assertIn('<mirrorOf>central</mirrorOf>', script)
        self.assertIn('/etc/maven/settings.xml', script)
        base = (HARNESS / 'Dockerfile.base').read_text()
        self.assertIn('configure-cn-sources.sh', base)

    def test_package_manager_defaults_and_runtime_render_dependencies_are_explicit(self):
        for name in ('Dockerfile.base', 'Dockerfile.tools.browser', 'Dockerfile.tools.media', 'Dockerfile.tool-market-host'):
            source = (HARNESS / name).read_text()
            for value in ('UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple',
                          'UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple',
                          'UV_PYTHON_DOWNLOADS=never',
                          'COREPACK_NPM_REGISTRY=https://registry.npmmirror.com'):
                self.assertIn(value, source, name)
        media = (HARNESS / 'Dockerfile.tools.media').read_text()
        for value in ('HYPERFRAMES_BROWSER_PATH=/usr/local/bin/byclaw-playwright-chromium',
                      'HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg',
                      'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'):
            self.assertIn(value, media)


if __name__ == '__main__':
    unittest.main()
