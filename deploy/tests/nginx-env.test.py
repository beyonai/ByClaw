#!/usr/bin/env python3
"""Nginx 配置生成与启动失败隔离；所有输入均为隔离目录中的虚构配置。"""

import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class NginxEnvironmentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="byclaw-nginx-env-")
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.deploy = self.work / "deploy"
        self.standalone = self.deploy / "standalone"
        self.config = self.deploy / "config"
        self.runtime_dir = self.work / "private tmp"
        self.standalone.mkdir(parents=True)
        (self.config / "ssl").mkdir(parents=True)
        self.runtime_dir.mkdir()
        for name in ("gen-nginx-conf.sh", "start-fe.sh"):
            shutil.copyfile(ROOT / "deploy" / "standalone" / name, self.standalone / name)
        for name in ("localhost.key", "localhost.crt"):
            (self.config / "ssl" / name).write_text("fixture", encoding="utf-8")
        self.template = self.config / "nginx-standalone.conf.tpl"
        self.template.write_text(
            "port={{BE_SERVER_PORT}} ws={{BE_WS_PORT}} suffix={{CONTAINER_SUFFIX}}\n",
            encoding="utf-8",
        )
        self.output = self.config / "nginx-standalone.conf"
        self.output.write_text("existing config\n", encoding="utf-8")
        # 只隔离生成器读取的变量；不允许开发机实际环境影响断言。
        self.environment = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.work),
            "TMPDIR": str(self.runtime_dir),
        }
        self.shared_runtime = self.work / ".env.runtime"
        self.shared_runtime.write_text("compose-owned\n", encoding="utf-8")

    def write_env(self, content: str) -> None:
        (self.work / ".env").write_text(content, encoding="utf-8")

    def run_generator(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["sh", str(self.standalone / "gen-nginx-conf.sh"), *arguments],
            cwd=self.work,
            env=self.environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_runtime_isolated(self) -> None:
        self.assertEqual([], list(self.runtime_dir.iterdir()))
        self.assertEqual("compose-owned\n", self.shared_runtime.read_text(encoding="utf-8"))

    def test_plaintext_and_missing_env_keep_defaults_and_backend_overrides(self) -> None:
        missing = self.run_generator()
        self.assertEqual(0, missing.returncode, missing.stderr)
        self.assertEqual("port=8086 ws=8082 suffix=standalone\n", self.output.read_text())
        self.write_env(
            "BE_SERVER_PORT=9086\nSTANDALONE_BACKEND_PORT=18086\n"
            "BE_WS_PORT=9082\nCONTAINER_SUFFIX=fixture\n"
        )
        plaintext = self.run_generator()
        self.assertEqual(0, plaintext.returncode, plaintext.stderr)
        self.assertEqual("port=18086 ws=9082 suffix=fixture\n", self.output.read_text())
        self.assert_runtime_isolated()

    def test_encrypted_env_uses_private_decryption_and_environment_template(self) -> None:
        self.write_env("BYCLAW_USER_PHONE_SM4_KEY=ENC(fixture)\nBE_SERVER_PORT=9086\n")
        (self.work / "nginx-standalone.conf.tpl").write_text("custom={{BE_SERVER_PORT}}\n")
        # 模拟现有解密器的参数优先级，覆盖从任意目录执行和携带额外参数的情况。
        decrypt = self.deploy / "env-decrypt.sh"
        decrypt.write_text(
            'decrypt_input="${1:-${_ENV_DECRYPT_SRC:-}}"\n'
            'decrypt_output="${2:-${_ENV_DECRYPT_DST:-}}"\n'
            '[ "$decrypt_input" = "../../.env" ] || exit 7\n'
            '[ -f "$decrypt_output" ] || exit 8\n'
            'cp "$decrypt_output" "$decrypt_output.permissions"\n'
            'mv "$decrypt_output.permissions" ../private-mode-fixture\n'
            'printf "BYCLAW_USER_PHONE_SM4_KEY=fixture-plain\\nBE_SERVER_PORT=9086\\n" '
            '> "$decrypt_output"\n',
            encoding="utf-8",
        )
        result = self.run_generator("unrelated-input", "unrelated-output")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("custom=9086\n", self.output.read_text())
        private_mode = stat.S_IMODE((self.deploy / "private-mode-fixture").stat().st_mode)
        self.assertEqual(0o600, private_mode)
        self.assertNotIn("fixture-plain", result.stdout + result.stderr)
        self.assert_runtime_isolated()

    def test_decryption_failure_retains_config_and_removes_private_plaintext(self) -> None:
        self.write_env("BYCLAW_USER_PHONE_SM4_KEY=ENC(fixture)\n")
        (self.deploy / "env-decrypt.sh").write_text(
            'printf "PARTIAL=fixture-plain\\n" > "$_ENV_DECRYPT_DST"\nexit 9\n',
            encoding="utf-8",
        )
        result = self.run_generator()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Nginx environment decryption failed", result.stderr)
        self.assertNotIn("fixture-plain", result.stdout + result.stderr)
        self.assertEqual("existing config\n", self.output.read_text())
        self.assert_runtime_isolated()

    def test_invalid_decrypted_shell_syntax_retains_config_and_cleans_runtime(self) -> None:
        self.write_env("BYCLAW_USER_PHONE_SM4_KEY=ENC(fixture)\n")
        (self.deploy / "env-decrypt.sh").write_text(
            'printf "INVALID=(\\n" > "$_ENV_DECRYPT_DST"\n', encoding="utf-8"
        )
        result = self.run_generator()
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("existing config\n", self.output.read_text())
        self.assert_runtime_isolated()

    def test_start_fe_does_not_call_compose_after_generator_failure(self) -> None:
        # Compose 检测不访问 Docker；记录命令即可证明没有启动或查询容器。
        (self.deploy / "compose-detect.sh").write_text(
            'COMPOSE="sh ../fake-compose.sh"\nCOMPOSE_ENV_FLAG=""\n', encoding="utf-8"
        )
        (self.deploy / "fake-compose.sh").write_text('echo "$*" >> ../compose-called\n')
        (self.standalone / "gen-nginx-conf.sh").write_text("exit 23\n", encoding="utf-8")
        result = subprocess.run(
            ["bash", str(self.standalone / "start-fe.sh")],
            env=self.environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(23, result.returncode)
        self.assertNotIn("Starting Frontend", result.stdout)
        self.assertFalse((self.deploy / "compose-called").exists())


if __name__ == "__main__":
    unittest.main()
