#!/usr/bin/env python3
"""Prepare application ingress without changing Codex configuration or sessions."""
import os
import subprocess
import sys

TOOL_ENTRYPOINT = '/usr/local/bin/byclaw-tool-slim-entrypoint'


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if not args:
        args = ['tools']
    if args == ['tools']:
        if os.geteuid() != 0:
            raise ValueError('Root is required to prepare the application gateway')
        subprocess.run(['/usr/local/bin/sandbox-app', 'init'], check=True)
    # Preserve the original argument validation, SSH/browser bootstrap and environment.
    os.execv(TOOL_ENTRYPOINT, [TOOL_ENTRYPOINT, *args])


if __name__ == '__main__':
    main()
