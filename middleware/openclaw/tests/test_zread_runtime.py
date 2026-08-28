from pathlib import Path
import re
import unittest


OPENCLAW_ROOT = Path(__file__).parents[1]
REPO_ROOT = OPENCLAW_ROOT.parents[1]
SKILL = OPENCLAW_ROOT / "skills" / "zread-wiki" / "SKILL.md"
DOCKERFILES = [OPENCLAW_ROOT / "Dockerfile", OPENCLAW_ROOT / "Dockerfile.byclaw"]


class ZreadRuntimeTests(unittest.TestCase):
    def test_skill_uses_the_existing_repository_and_streams_progress(self):
        contents = SKILL.read_text(encoding="utf-8")
        frontmatter = re.match(r"^---\n(.*?)\n---\n", contents, flags=re.DOTALL)

        self.assertIsNotNone(frontmatter)
        self.assertRegex(frontmatter.group(1), r"(?m)^name:\s*zread-wiki\s*$")
        self.assertIn("Zread 不负责克隆、拉取或更新仓库", contents)
        self.assertIn(
            "zread generate --stdio -y --draft resume --skip-failed",
            contents,
        )
        self.assertIn(".zread/wiki/", contents)
        self.assertIn("持续读取 stdout 的 JSON-line 事件", contents)

    def test_runtime_images_install_and_verify_the_pinned_cli(self):
        for dockerfile in DOCKERFILES:
            with self.subTest(dockerfile=dockerfile.name):
                contents = dockerfile.read_text(encoding="utf-8")
                self.assertIn("ARG ZREAD_CLI_VERSION=0.2.13", contents)
                self.assertIn('"zread_cli@${ZREAD_CLI_VERSION}"', contents)
                self.assertIn("zread version --stdio", contents)

    def test_legacy_repo_wiki_runtime_is_removed(self):
        plugin_root = (
            REPO_ROOT / "byclaw-exe" / "extensions" / "baiying-enhance"
        )
        self.assertFalse((plugin_root / "src" / "code-to-wiki-tool.ts").exists())
        self.assertFalse(
            (plugin_root / "src" / "code-to-wiki-tool.test.ts").exists()
        )
        self.assertFalse((OPENCLAW_ROOT / "repowiki-entrypoint.py").exists())


if __name__ == "__main__":
    unittest.main()
