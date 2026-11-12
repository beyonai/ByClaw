"""Build-source defaults must fail closed rather than silently go overseas."""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / 'middleware/byclaw-harness'


class ToolSandboxDomesticSourcesTest(unittest.TestCase):
    def test_business_manifests_match_release_tags(self):
        for purpose in ('browser', 'media', 'unity', 'godot', 'general'):
            manifest = json.loads((HARNESS / 'tool-sandbox' / f'{purpose}.capabilities.json').read_text())
            self.assertEqual(manifest['purpose'], purpose)
            self.assertEqual(manifest['runtimeVersion'], f'D0.6.0_{purpose}')

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

    def test_business_images_default_to_the_internal_slim_family(self):
        for name, tag in (('Dockerfile.tools.browser', 'D0.6.0_base_slim'),
                          ('Dockerfile.tools.media', 'D0.6.0_browser')):
            self.assertIn(f'ARG TOOLS_IMAGE=192.168.0.81:8080/byclaw/byclaw-harness-tools:{tag}',
                          (HARNESS / name).read_text(), name)
        for name in ('Dockerfile.tools.unity', 'Dockerfile.tools.godot'):
            self.assertIn('ARG BROWSER_IMAGE=192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser',
                          (HARNESS / name).read_text(), name)
        self.assertRegex((HARNESS / 'Dockerfile.tool-market-host').read_text(), r'(?m)^ARG HARNESS_IMAGE\s*$')

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
            'Dockerfile.tools.base-slim': 'TOOLS_IMAGE',
            'Dockerfile.tools.unity': 'BROWSER_IMAGE',
            'Dockerfile.tools.godot': 'BROWSER_IMAGE',
            'Dockerfile.tools.general': 'BROWSER_IMAGE',
            'Dockerfile.tool-market-host': 'HARNESS_IMAGE',
        }
        for name, variable in expected.items():
            source = (HARNESS / name).read_text()
            defaults = re.findall(rf'(?m)^ARG {variable}=(\S+)$', source)
            if name in {'Dockerfile', 'Dockerfile.extensions', 'Dockerfile.slim', 'Dockerfile.tools', 'Dockerfile.tool_slim', 'Dockerfile.tools.browser', 'Dockerfile.tools.media', 'Dockerfile.tools.unity', 'Dockerfile.tools.godot', 'Dockerfile.tools.general', 'Dockerfile.tools.base-slim'}:
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
                self.assertTrue(image == 'scratch' or image in stages or image == '${' + variable + '}'
                                or (name == 'Dockerfile.tools.browser' and image == '${HARNESS_IMAGE}')
                                or (name == 'Dockerfile.tools.base-slim' and image == '${RUNTIME_IMAGE}')
                                or (name == 'Dockerfile.tools.unity' and image == '${UNITY_DONOR_IMAGE}')
                                or (name == 'Dockerfile.tools.general' and image == '${HARNESS_IMAGE}'),
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
        for name in ('Dockerfile.base', 'Dockerfile.tools.browser', 'Dockerfile.tools.media', 'Dockerfile.tools.general', 'Dockerfile.tool-market-host'):
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

    def test_browser_layer_needs_only_base_slim_and_its_harness(self):
        source = (HARNESS / 'Dockerfile.tools.browser').read_text()
        self.assertEqual(re.findall(r'(?m)^FROM (\S+)', source), ['${HARNESS_IMAGE}', '${TOOLS_IMAGE}'])
        for donor in ('BROWSER_DONOR_IMAGE', 'INSTALLED_BROWSER_IMAGE'):
            self.assertNotIn(donor, source)
        self.assertIn('playwright-core/package.json', source)
        self.assertIn('PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright', source)
        self.assertIn('playwright install --with-deps chromium', source)
        self.assertIn('"@sovovs/bycli@${BYCLI_VERSION}"', source)

    def test_general_sandbox_layers_on_browser_without_java_or_ffmpeg(self):
        source = (HARNESS / 'Dockerfile.tools.general').read_text()
        self.assertIn('ARG BROWSER_IMAGE=192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser', source)
        self.assertIn('FROM ${BROWSER_IMAGE} AS general', source)
        self.assertNotIn('RTK_DOWNLOAD_BASE', source)
        self.assertIn('BYCLAW_BROWSER_STARTUP=on-demand', source)
        install = re.search(r'apt-get install -y --no-install-recommends \\\n(.*?);', source, re.S).group(1)
        for package in ('openjdk', 'maven', 'ffmpeg'):
            self.assertNotIn(package, install)

    def test_base_slim_collects_the_helper_from_its_donor(self):
        source = (HARNESS / 'Dockerfile.tools.base-slim').read_text()
        self.assertIn('collect-closure.sh /tmp/tool-env-closure.tar', source)
        self.assertIn('COPY --from=transport /transport/workspace/ /workspace/', source)
        self.assertNotIn('COPY --from=transport /workspace/ /workspace/', source)
        ignore = (HARNESS / 'Dockerfile.tools.base-slim.dockerignore').read_text()
        self.assertIn('!middleware/byclaw-harness/plugins/dsh-tool-env/docker/collect-closure.sh', ignore)

    def test_tool_family_builds_from_internal_harbor_without_arguments(self):
        for name in ('Dockerfile.tools.base-slim', 'Dockerfile.tools.browser', 'Dockerfile.tools.general'):
            source = (HARNESS / name).read_text()
            for variable in re.findall(r'(?m)^FROM \$\{(\w+)\}', source):
                defaults = re.findall(rf'(?m)^ARG {variable}=(\S+)$', source)
                self.assertEqual(len(defaults), 1, f'{name}: {variable} needs a default')
                if variable != 'RUNTIME_IMAGE':
                    self.assertTrue(defaults[0].startswith('192.168.0.81:8080/'), f'{name}: {variable}')
        # The OS runtime is the public Debian 13 Python image; ByClaw images come from Harbor.
        runtime = re.findall(r'(?m)^ARG RUNTIME_IMAGE=(\S+)$', (HARNESS / 'Dockerfile.tools.base-slim').read_text())
        self.assertEqual(runtime, ['python:3.12-slim-trixie'])


if __name__ == '__main__':
    unittest.main()
