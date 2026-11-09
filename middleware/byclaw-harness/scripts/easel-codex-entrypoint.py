#!/usr/bin/env python3
"""Prepare the persistent Easel source tree, then start the ByClaw tool runtime."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SOURCE = Path('/opt/easel-source')
WORKSPACE_ROOT = Path('/by')
WORKSPACE = WORKSPACE_ROOT / 'Easel'
TOOL_ENTRYPOINT = '/usr/local/bin/byclaw-tool-slim-entrypoint'
SOURCE_REVISION = '5c12e42e9019d276368130b52385b770749ffa6f'
REVISION_FILE = '.byclaw-easel-source-revision'


def log(message: str) -> None:
    print(f'[easel-codex] {message}', flush=True)


def write_if_missing(path: Path, content: str) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


def prepare_workspace() -> None:
    if not SOURCE.is_dir() or not (SOURCE / 'pyproject.toml').is_file():
        raise RuntimeError('packaged Easel source is missing')

    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    if not WORKSPACE.exists():
        shutil.copytree(SOURCE, WORKSPACE)
        (WORKSPACE / REVISION_FILE).write_text(SOURCE_REVISION + '\n', encoding='utf-8')
        subprocess.run(
            ['chown', '-R', 'byclaw:byclaw', str(WORKSPACE)],
            check=True,
        )
        log(f'initialized editable source at {WORKSPACE}')
    elif not (WORKSPACE / 'pyproject.toml').is_file():
        raise RuntimeError(f'{WORKSPACE} exists but is not an Easel source tree; refusing to overwrite it')

    venv_link = WORKSPACE / '.venv'
    if venv_link.is_symlink() or not venv_link.exists():
        if venv_link.is_symlink():
            venv_link.unlink()
        venv_link.symlink_to('/opt/easel-venv', target_is_directory=True)

    env_file = WORKSPACE / '.env'
    if not env_file.exists():
        shutil.copy2(WORKSPACE / '.env.example', env_file)

    harness = WORKSPACE / 'outputs' / '_harness' / 'config.json'
    write_if_missing(
        harness,
        json.dumps({
            'runtime': 'codex',
            'models': {},
            'sandbox': 'workspace-write',
            'codex_auto_approve': False,
        }, ensure_ascii=False, indent=2) + '\n',
    )

    write_if_missing(
        WORKSPACE / 'AGENTS.md',
        '\n'.join([
            '# Easel Codex sandbox',
            '',
            'Easel is installed in `/opt/easel-venv`; this directory is the writable source.',
            'Use `/opt/easel-venv/bin/python` or `.venv`, run `pytest`, and rebuild frontend',
            'changes with `cd web/frontend && npm ci && npm run build`.',
            '`EASEL_AGENT_RUNTIME=codex` and `outputs/_harness/config.json` select Codex.',
            'OpenClaw is intentionally absent. Credentials stay in native CLI configuration.',
            'Ask the user before publishing to external social platforms or other irreversible side effects.',
            '',
        ]),
    )

    codex_home = WORKSPACE_ROOT / '.codex'
    codex_home.mkdir(mode=0o700, parents=True, exist_ok=True)
    subprocess.run(['chown', '-R', 'byclaw:byclaw', str(codex_home)], check=True)
    os.chmod(codex_home, 0o700)


def main() -> int:
    if sys.argv[1:] != ['tools']:
        raise ValueError('Easel Codex sandbox supports tools mode only')
    if os.geteuid() != 0:
        raise ValueError('Root is required to initialize /by before starting SSH')

    prepare_workspace()
    os.environ['EASEL_AGENT_RUNTIME'] = 'codex'
    os.environ['CODEX_HOME'] = str(WORKSPACE_ROOT / '.codex')
    os.environ['EASEL_PROJECT_ROOT'] = str(WORKSPACE)
    os.environ['PYTHONPATH'] = str(WORKSPACE)
    os.environ['PATH'] = '/opt/easel-venv/bin:' + os.environ.get('PATH', '')
    log('Easel source, Codex CLI and runtime dependencies ready')
    os.execv(TOOL_ENTRYPOINT, [TOOL_ENTRYPOINT, 'tools'])
    return 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        log(str(error))
        raise SystemExit(1) from None
