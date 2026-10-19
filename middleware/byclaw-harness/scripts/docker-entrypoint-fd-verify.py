#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
ENTRYPOINT = Path(os.environ.get("BYCLAW_TEST_ENTRYPOINT", str(ROOT / "docker-entrypoint.sh")))
SECRET_HELPER = Path(
    os.environ.get(
        "BYCLAW_TEST_SECRET_HELPER",
        str(ROOT / "plugins" / "dsh-browser-use" / "lib" / "secret-fd.js"),
    )
)


def main() -> None:
    if not SECRET_HELPER.is_file():
        raise AssertionError("build dsh-browser-use before running the FD integration test")

    with tempfile.TemporaryDirectory(prefix="dsh-entrypoint-fd-", dir="/tmp") as raw_root:
        test_root = Path(raw_root)
        workspace = test_root / "workspace"
        (workspace / "node_modules" / "tsx").mkdir(parents=True)
        (workspace / "node_modules" / "tsx" / "package.json").write_text(
            json.dumps({
                "name": "tsx",
                "type": "module",
                "exports": {"./esm": "./esm.mjs"},
            })
        )
        (workspace / "node_modules" / "tsx" / "esm.mjs").write_text("")
        cli = test_root / "fake-dsh-cli.mjs"
        record = test_root / "record.json"
        cli.write_text(
            f"""import {{ spawnSync }} from 'node:child_process';
import {{ readBrowserSecretFromEnvironment }} from {json.dumps(SECRET_HELPER.as_uri())};
const descriptor = process.env.BYCLAW_BROWSER_SECRET_FD;
const secret = readBrowserSecretFromEnvironment();
let secondRead = '';
try {{ readBrowserSecretFromEnvironment(); }} catch (error) {{ secondRead = error.message; }}
const child = spawnSync('bash', ['-c', 'if true <&"$1" 2>/dev/null; then exit 41; fi', '_', descriptor]);
await import('node:fs').then(fs => fs.writeFileSync(process.env.BYCLAW_TEST_RECORD, JSON.stringify({{
  argv: process.argv.slice(2),
  secret,
  secondRead,
  childStatus: child.status,
  fdEnvRemoved: !('BYCLAW_BROWSER_SECRET_FD' in process.env),
}})));
"""
        )

        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"fd-secret")
        os.close(write_fd)
        try:
            result = subprocess.run(
                ["bash", str(ENTRYPOINT), "web", "--port", "8080", "--no-open"],
                env={
                    **os.environ,
                    "BYCLAW_DSH_PREPARED": "1",
                    "BYCLAW_BROWSER_SECRET_FD": str(read_fd),
                    "BYCLAW_DSH_CLI_ENTRY": str(cli),
                    "BYCLAW_TEST_RECORD": str(record),
                    "DSH_ROOT": str(workspace),
                },
                pass_fds=(read_fd,),
                text=True,
                capture_output=True,
                timeout=10,
            )
        finally:
            os.close(read_fd)

        assert result.returncode == 0, result
        actual = json.loads(record.read_text())
        assert actual == {
            "argv": ["web", "--host", "0.0.0.0", "--port", "8080", "--no-open"],
            "secret": "fd-secret",
            "secondRead": "browser-broker-secret-unavailable",
            "childStatus": 0,
            "fdEnvRemoved": True,
        }

    print("docker entrypoint FD verification passed")


if __name__ == "__main__":
    main()
