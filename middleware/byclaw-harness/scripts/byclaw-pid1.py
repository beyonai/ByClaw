#!/usr/bin/env python3
"""Run one command as this process's child and reap every process orphaned under it.

The shared DSH host (entrypoint `multi-host` mode) used to exec Node as the container's
PID 1. Node does not reap adopted orphans, and every closed SSH-over-WebSocket tool
connection leaves one behind (ssh exits, its ProxyCommand child is reparented), so
zombies accumulated until the PID space ran out. This wrapper registers as a child
subreaper, so it collects those orphans whether or not it is PID 1 (and stays harmless
under docker --init), forwards termination and user signals to the command, and exits
with the command's status.

    byclaw-pid1 <command> [args...]
"""
import ctypes
import os
import signal
import sys

PR_SET_CHILD_SUBREAPER = 36
FORWARDED = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT, signal.SIGUSR1, signal.SIGUSR2)


def main(argv: list[str]) -> int:
    if not argv:
        print('usage: byclaw-pid1 <command> [args...]', file=sys.stderr)
        return 64
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        print(f'byclaw-pid1: subreaper unavailable: {os.strerror(ctypes.get_errno())}', file=sys.stderr)
    # Block forwarded signals until the child exists, so none is lost or delivered to us alone.
    signal.pthread_sigmask(signal.SIG_BLOCK, FORWARDED)
    child = os.fork()
    if child == 0:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, FORWARDED)
        try:
            os.execvp(argv[0], argv)
        except OSError as error:
            print(f'byclaw-pid1: cannot run {argv[0]}: {error.strerror}', file=sys.stderr)
            os._exit(127)
    for number in FORWARDED:
        signal.signal(number, lambda received, _frame: os.kill(child, received))
    signal.pthread_sigmask(signal.SIG_UNBLOCK, FORWARDED)
    while True:
        try:
            pid, status = os.wait()
        except ChildProcessError:
            return 0
        except InterruptedError:
            continue
        if pid == child:
            # Collect whatever is already dead, then leave the rest to the container's end.
            while True:
                try:
                    if os.waitpid(-1, os.WNOHANG)[0] == 0:
                        break
                except ChildProcessError:
                    break
            if os.WIFSIGNALED(status):
                return 128 + os.WTERMSIG(status)
            return os.WEXITSTATUS(status)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
