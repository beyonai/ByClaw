#!/usr/bin/env python3
"""Generate a browser-renderable QR code data URI with lark-cli.

The lark-cli qrcode command writes a PNG file to disk. A local file path cannot
be rendered by the ByClaw/OpenClaw chat page, so this helper converts the PNG to
a data:image/png;base64 URI that can be embedded directly in Markdown.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create QR code data URI for a Feishu/Lark URL.")
    parser.add_argument("url", help="The authorization or app configuration URL to encode.")
    parser.add_argument("--alt", default="飞书授权二维码", help="Markdown image alt text.")
    parser.add_argument("--cli", default=os.environ.get("LARK_CLI_BIN", "lark-cli"), help="lark-cli executable.")
    parser.add_argument("--timeout", type=int, default=30, help="qrcode command timeout in seconds.")
    return parser.parse_args()


def fail(message: str, *, stderr: str = "") -> int:
    payload = {"ok": False, "error": message}
    if stderr:
        payload["stderr"] = stderr.strip()
    print(json.dumps(payload, ensure_ascii=False))
    return 1


def main() -> int:
    args = parse_args()

    if not args.url.startswith(("http://", "https://")):
        return fail("URL must start with http:// or https://")

    try:
        with tempfile.TemporaryDirectory(prefix="fws-qrcode-") as tmp_dir:
            tmp_dir_path = Path(tmp_dir)
            tmp_dir_path.chmod(0o700)
            output_arg = "./qrcode.png"
            png_path = tmp_dir_path / "qrcode.png"

            proc = subprocess.run(
                [args.cli, "auth", "qrcode", args.url, "--output", output_arg],
                cwd=tmp_dir_path,
                capture_output=True,
                text=True,
                timeout=args.timeout,
                check=False,
            )
            if proc.returncode != 0:
                return fail("lark-cli auth qrcode failed", stderr=proc.stderr or proc.stdout)
            if not png_path.exists() or png_path.stat().st_size <= 0:
                return fail("lark-cli did not create a QR code image", stderr=proc.stderr or proc.stdout)

            png_path.chmod(0o600)
            data_uri = "data:image/png;base64," + base64.b64encode(png_path.read_bytes()).decode("ascii")
            payload = {
                "ok": True,
                "dataUri": data_uri,
                "markdownImage": f"![{args.alt}]({data_uri})",
            }
            print(json.dumps(payload, ensure_ascii=False))
            return 0
    except subprocess.TimeoutExpired:
        return fail(f"lark-cli auth qrcode timed out after {args.timeout}s")
    except FileNotFoundError:
        return fail(f"Cannot find lark-cli executable: {args.cli}")
    except Exception as exc:  # Defensive: never make the caller render a broken image.
        return fail(str(exc))


if __name__ == "__main__":
    sys.exit(main())
