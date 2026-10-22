#!/usr/bin/env python3
"""Serialize managed byCLI browser commands with Jev goal runs; never log arguments."""
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time


def ensure_runtime(args):
    broker = os.environ.get('BYCLAW_BROWSER_SOCKET')
    path = os.environ.get('BYCLAW_BROWSER_ACTIVATION_SOCKET') or (broker + '.activate' if broker else None)
    if not path or not args or args[0] in ('daemon', 'doctor', '--help', '-h', '--version', '-V', 'list'):
        return
    if '--help' in args or '-h' in args:
        return
    # No browser secret crosses the shell boundary. The supervisor supplies a
    # same-user 0600 control socket accepting only this fixed activation verb.
    deadline = time.monotonic() + float(os.environ.get('BYCLAW_BROWSER_READY_TIMEOUT_MS', '60000')) / 1000 * 3
    while time.monotonic() < deadline:
        try:
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(max(0.01, deadline - time.monotonic()))
                client.connect(path)
                client.sendall(b'bycli\n')
                reply = b''
                while b'\n' not in reply and len(reply) < 32:
                    chunk = client.recv(32)
                    if not chunk:
                        break
                    reply += chunk
                if reply != b'ready\n':
                    raise RuntimeError('bycli-runtime-unavailable')
                return
        except (FileNotFoundError, ConnectionRefusedError):
            time.sleep(0.05)
    raise RuntimeError('bycli-runtime-readiness-timeout')


def main():
    root = Path('/opt/nvm/current/lib/node_modules/@sovovs/bycli')
    package = json.loads((root / 'package.json').read_text())
    binary = package['bin']
    entry = root / (binary['bycli'] if isinstance(binary, dict) else binary)
    args = sys.argv[1:]
    try:
        ensure_runtime(args)
    except (OSError, RuntimeError, ValueError):
        print('bycli-runtime-unavailable: browser or bridge startup failed; retry the command', file=sys.stderr)
        return 75
    if args == ['--byclaw-ensure-runtime']:
        return 0
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
