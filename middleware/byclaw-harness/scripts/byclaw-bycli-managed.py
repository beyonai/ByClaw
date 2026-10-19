#!/usr/bin/env python3
"""Serialize managed byCLI browser commands with Jev goal runs; never log arguments."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    root = Path('/opt/nvm/current/lib/node_modules/@sovovs/bycli')
    package = json.loads((root / 'package.json').read_text())
    binary = package['bin']
    entry = root / (binary['bycli'] if isinstance(binary, dict) else binary)
    args = sys.argv[1:]
    enabled = os.environ.get('BYCLAW_BROWSER_JEV_ENABLED', '').strip().lower() in ('true', '1', 'yes', 'on')
    # Supervisor/bridge health must remain available while automation owns the browser.
    exempt = not args or args[0] in ('daemon', 'doctor', '--help', '-h', '--version', '-V', 'list')
    command = ['/opt/nvm/current/bin/node', str(entry), *args]
    if not enabled or exempt:
        os.execv(command[0], command)
    path = Path(os.environ.get('BYCLAW_BROWSER_AUTOMATION_LOCK', '/run/byclaw-browser/automation.lock'))
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open('a') as lock:
        path.chmod(0o600)
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    print('browser-automation-busy: Jev goal or another byCLI command owns the browser', file=sys.stderr)
                    return 75
                time.sleep(0.1)
        child = subprocess.Popen(command, pass_fds=(lock.fileno(),))
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(signum, lambda signum, _frame: child.send_signal(signum))
        return child.wait()


if __name__ == '__main__':
    sys.exit(main())
