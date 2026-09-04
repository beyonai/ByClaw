import hashlib
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SKILL_ROOT = REPOSITORY_ROOT / 'middleware' / 'openclaw' / 'skills' / 'ima-skill'
ROOT_SKILL = SKILL_ROOT / 'SKILL.md'
NOTES_SKILL = SKILL_ROOT / 'notes' / 'SKILL.md'
KNOWLEDGE_BASE_SKILL = SKILL_ROOT / 'knowledge-base' / 'SKILL.md'
UPSTREAM_TARBALL = 'https://registry.npmjs.org/ima-openapi-cli/-/ima-openapi-cli-0.1.3.tgz'
UPSTREAM_SRI = 'sha512-ckur/WWHugygFu130u/Zmn2IU9w7Ghc2cmPPxS6lFWvETSz7Rl3lqQGjMLmhSbTY2eCIR8DvqOzozOf5rWRbHg=='
UPSTREAM_SHASUM = 'dc86270926d634bbc713d67403d537741f5a10b1'
NON_EXECUTABLE_REFERENCE_NOTICE = 'ByClaw Runtime notice — non-executable reference'

# SHA-256 digests from the verified ima-openapi-cli@0.1.3 npm tarball. Keeping
# them local makes this contract test deterministic and avoids a network fetch.
UPSTREAM_SCRIPT_HASHES = {
    SKILL_ROOT / 'knowledge-base' / 'scripts' / 'cos-upload.cjs': (
        '6c9816826123c0c7e5ffdeb89dc5605c6ac440021b97157205079c3f20cdefda'
    ),
    SKILL_ROOT / 'knowledge-base' / 'scripts' / 'preflight-check.cjs': (
        '1f80292cd6339e85d6b400f37375d5442eb47647415af8206475c31efa5518aa'
    ),
}

UPSTREAM_SOURCE_HASHES = {
    ROOT_SKILL: '05792ef64efe9899dd3276f26c1d25255d9c28ed086d2a80ef3f32b6ddb2b6ab',
    NOTES_SKILL: 'e5a14ace422b50b1dbc51cc7a50ee8bd032a7910bc178c68671e2fbc1262f7ac',
    KNOWLEDGE_BASE_SKILL: 'c60d2f2844f49dea08e4bfc0341e83252d4207218c1ce2a70c01553f7e4f7649',
    SKILL_ROOT / 'notes' / 'references' / 'api.md': '9a27d01077bfc648bc0b1fc737b02856067b1c120a5dc728130b546127ebb01b',
    SKILL_ROOT / 'knowledge-base' / 'references' / 'api.md': '676a695ed930b88ff8f18783b6486fc502162eb5d45f4db76388c18d6a48c034',
    **UPSTREAM_SCRIPT_HASHES,
}

# These are the only documentation files intentionally transformed by ByClaw.
# API references and both bundled CJS scripts are verified against the npm bytes.
LOCAL_BYCLAW_TRANSFORMS = {
    ROOT_SKILL: 'runtime policy replacement',
    NOTES_SKILL: 'CLI-only runtime guide replacement',
    KNOWLEDGE_BASE_SKILL: 'CLI-only runtime guide replacement',
    SKILL_ROOT / 'preflight-check.cjs': 'local wrapper around the bundled preflight script',
}

LOCAL_BYCLAW_TRANSFORM_HASHES = {
    ROOT_SKILL: 'af8b77237bc1a8bfa1f4f6a7cc8b411a3b163cd8e5fb1944c425db899f2587d9',
    NOTES_SKILL: 'd6312ff21b914330196c1dc6bfc0b59e2fc90d199f31d93903e9c9a305e97cbe',
    KNOWLEDGE_BASE_SKILL: '31a8d1cf94383e226e00ebec5adc06994b4a380f31baeb0012fe683ab484bf64',
    SKILL_ROOT / 'preflight-check.cjs': 'c16d9df00dc86c278d00f68b62ad10481f7d38c5903d13b0debfbfd2a16acb52',
}


class ImaSkillContractTest(unittest.TestCase):
    def test_ima_skill_runtime_contract(self):
        self._assert_expected_bundle_exists()
        root_contents = ROOT_SKILL.read_text(encoding='utf-8')

        self._assert_root_frontmatter(root_contents)
        self._assert_root_provenance(root_contents)
        self._assert_root_runtime_policy(root_contents)
        self._assert_upstream_hash_allowlist()
        self._assert_upstream_scripts_are_unmodified()
        self._assert_non_cos_scripts_are_local_only()
        self._assert_legacy_paths_and_direct_http_guidance_are_scoped(root_contents)
        self._assert_byclaw_upload_limit_is_enforced(root_contents)

    def _assert_byclaw_upload_limit_is_enforced(self, root_contents):
        knowledge_contents = KNOWLEDGE_BASE_SKILL.read_text(encoding='utf-8')
        self.assertIn('20 MiB', root_contents)
        self.assertIn('20 MiB', knowledge_contents)
        with tempfile.NamedTemporaryFile(suffix='.pdf') as upload:
            upload.truncate(20 * 1024 * 1024 + 1)
            for file_args in (['--file', upload.name], [f'--file={upload.name}']):
                result = subprocess.run(
                    ['node', str(SKILL_ROOT / 'preflight-check.cjs'), *file_args],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 1)
                self.assertIn('20.0 MB', result.stdout)

    def _assert_expected_bundle_exists(self):
        required_files = (
            ROOT_SKILL,
            NOTES_SKILL,
            SKILL_ROOT / 'notes' / 'references' / 'api.md',
            KNOWLEDGE_BASE_SKILL,
            SKILL_ROOT / 'knowledge-base' / 'references' / 'api.md',
            SKILL_ROOT / 'knowledge-base' / 'scripts' / 'cos-upload.cjs',
            SKILL_ROOT / 'knowledge-base' / 'scripts' / 'preflight-check.cjs',
            SKILL_ROOT / 'preflight-check.cjs',
        )
        for required_file in required_files:
            self.assertTrue(required_file.is_file(), f'{required_file.relative_to(SKILL_ROOT)} must exist')

    def _assert_root_frontmatter(self, root_contents):
        frontmatter = re.match(r'^---\n(.*?)\n---\n', root_contents, flags=re.DOTALL)
        self.assertIsNotNone(frontmatter, 'root SKILL.md must have YAML frontmatter')
        self.assertRegex(frontmatter.group(1), r'(?m)^name:\s*ima-skill\s*$')
        self.assertRegex(frontmatter.group(1), r'(?m)^cli_version:\s*["\']?=0\.1\.3["\']?\s*$')
        self.assertRegex(frontmatter.group(1), r'(?m)^byclaw_managed:\s*true\s*$')

    def _assert_root_runtime_policy(self, root_contents):
        self.assertIn('ima-openapi-cli', root_contents)
        self.assertIn('IMA_OPENAPI_CLIENTID', root_contents)
        self.assertIn('IMA_OPENAPI_APIKEY', root_contents)
        self.assertRegex(root_contents, r'(?s)缺失.{0,120}连接器设置.{0,120}重新连接')

        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}ima auth config')
        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}curl')
        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}ima_api')
        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}(读取|访问).{0,80}凭证文件')
        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}(展示|显示).{0,80}凭证')
        self.assertRegex(root_contents, r'(?s)(禁止|不得).{0,120}(聊天|对话).{0,80}(索取|询问)')

        self.assertIn('--json', root_contents)
        self.assertIn('auth check --test --json', root_contents)
        self.assertIn('checks.token_fetch', root_contents)
        self.assertRegex(root_contents, r'(?s)(退出码|exit code).{0,120}JSON')
        self.assertRegex(root_contents, r'(?s)鉴权失败.{0,120}(停止|终止)')
        self.assertRegex(root_contents, r'(?s)写操作.{0,120}(不得|禁止).{0,80}(重试|retry)')

    def _assert_root_provenance(self, root_contents):
        frontmatter = re.match(r'^---\n(.*?)\n---\n', root_contents, flags=re.DOTALL)
        self.assertIsNotNone(frontmatter)
        metadata = frontmatter.group(1)
        self.assertRegex(metadata, r'(?m)^upstream_package:\s*["\']?ima-openapi-cli@0\.1\.3["\']?\s*$')
        self.assertIn(UPSTREAM_TARBALL, metadata)
        self.assertIn(UPSTREAM_SRI, metadata)
        self.assertIn(UPSTREAM_SHASUM, metadata)

    def _assert_upstream_hash_allowlist(self):
        self.assertEqual(len(UPSTREAM_SOURCE_HASHES), 7)
        self.assertEqual(set(UPSTREAM_SCRIPT_HASHES), set(UPSTREAM_SOURCE_HASHES) & set(UPSTREAM_SCRIPT_HASHES))
        self.assertEqual(
            set(LOCAL_BYCLAW_TRANSFORMS),
            {ROOT_SKILL, NOTES_SKILL, KNOWLEDGE_BASE_SKILL, SKILL_ROOT / 'preflight-check.cjs'},
        )
        self.assertEqual(set(LOCAL_BYCLAW_TRANSFORM_HASHES), set(LOCAL_BYCLAW_TRANSFORMS))
        for transformed_path, expected_hash in LOCAL_BYCLAW_TRANSFORM_HASHES.items():
            actual_hash = hashlib.sha256(transformed_path.read_bytes()).hexdigest()
            self.assertEqual(actual_hash, expected_hash, f'unexpected local transform: {transformed_path}')

    def _assert_upstream_scripts_are_unmodified(self):
        for script_path, expected_hash in UPSTREAM_SCRIPT_HASHES.items():
            actual_hash = hashlib.sha256(script_path.read_bytes()).hexdigest()
            self.assertEqual(actual_hash, expected_hash, f'{script_path.relative_to(SKILL_ROOT)} must match npm artifact')

        wrapper_contents = (SKILL_ROOT / 'preflight-check.cjs').read_text(encoding='utf-8')
        self.assertIn('MAX_BYCLAW_UPLOAD_BYTES = 20 * 1024 * 1024', wrapper_contents)
        self.assertTrue(wrapper_contents.endswith("require('./knowledge-base/scripts/preflight-check.cjs');\n"))

    def _assert_non_cos_scripts_are_local_only(self):
        cos_upload = SKILL_ROOT / 'knowledge-base' / 'scripts' / 'cos-upload.cjs'
        forbidden_network = r'(?i)\b(fetch|http|https|net|child_process|spawn|exec|curl)\b'
        forbidden_credentials = r'(?i)(IMA_OPENAPI|credential|api[_ -]?key|client[_ -]?id|process\.env)'

        for script_path in SKILL_ROOT.rglob('*.cjs'):
            if script_path == cos_upload:
                continue
            contents = script_path.read_text(encoding='utf-8')
            self.assertNotRegex(contents, forbidden_network, script_path)
            self.assertNotRegex(contents, forbidden_credentials, script_path)

    def _assert_legacy_paths_and_direct_http_guidance_are_scoped(self, root_contents):
        skill_documents = (ROOT_SKILL, NOTES_SKILL, KNOWLEDGE_BASE_SKILL)
        reference_documents = (
            SKILL_ROOT / 'notes' / 'references' / 'api.md',
            SKILL_ROOT / 'knowledge-base' / 'references' / 'api.md',
        )
        for skill_document in skill_documents:
            contents = skill_document.read_text(encoding='utf-8')
            self.assertNotIn('.claude/skills/ima-skill', contents, skill_document)

        for reference_document in reference_documents:
            contents = reference_document.read_text(encoding='utf-8')
            prefix = (
                '> **ByClaw Runtime notice — non-executable reference:** This upstream API document is retained '
                'for field lookup only. Do not construct HTTP calls, use `curl`, or use an `ima_api` helper from '
                'this document. Use the corresponding `ima ' + ('note' if reference_document.parts[-3] == 'notes' else 'wiki')
                + ' … --json` command instead.\n\n'
            )
            self.assertTrue(contents.startswith(prefix), reference_document)
            upstream_body = contents.removeprefix(prefix).encode('utf-8')
            self.assertEqual(
                hashlib.sha256(upstream_body).hexdigest(),
                UPSTREAM_SOURCE_HASHES[reference_document],
                f'{reference_document.relative_to(SKILL_ROOT)} must retain its upstream body exactly',
            )

        for child_skill in (NOTES_SKILL, KNOWLEDGE_BASE_SKILL):
            child_contents = child_skill.read_text(encoding='utf-8')
            self.assertRegex(child_contents, r'(?s)(禁止|不得).{0,160}(HTTP|curl|ima_api)', child_skill)

        self.assertNotIn('cos-upload.cjs', root_contents)
        knowledge_base_contents = KNOWLEDGE_BASE_SKILL.read_text(encoding='utf-8')
        self.assertRegex(knowledge_base_contents, r'(?s)(不应|禁止).{0,120}(对话工作流|会话).{0,120}直接执行')

        for skill_file in SKILL_ROOT.rglob('*'):
            if skill_file.suffix not in {'.md', '.cjs'}:
                continue

            contents = skill_file.read_text(encoding='utf-8')
            self.assertNotIn('.claude/skills/ima-skill', contents, skill_file)
            if not re.search(r'curl|ima_api', contents):
                continue

            if skill_file in skill_documents:
                self.assertRegex(contents, r'(?s)(禁止|不得).{0,160}(curl|ima_api)', skill_file)
                continue

            if skill_file.parent.name == 'references':
                first_five_lines = '\n'.join(contents.splitlines()[:5])
                self.assertIn(NON_EXECUTABLE_REFERENCE_NOTICE, first_five_lines, skill_file)
                for line_number, line in enumerate(contents.splitlines(), start=1):
                    if re.search(r'curl|ima_api', line):
                        self.assertLessEqual(line_number, 5, f'{skill_file}: direct HTTP guidance must remain in the notice')
                continue

            self.fail(f'unscoped direct HTTP reference in executable file: {skill_file}')


if __name__ == '__main__':
    unittest.main()
