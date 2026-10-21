"""Initialize the pinned CLI's SQLite cache before engine worker threads start."""

import fcntl
import os
from pathlib import Path
import sys


def main():
    # Settings must be selected before importing SearXNG, including its cache.
    os.environ['SEARXNG_SETTINGS_PATH'] = str(Path(os.environ['SEARXNG_CLI_SETTINGS']).expanduser().resolve())
    from searx.enginelib import ENGINES_CACHE

    # Serialize the first schema creation across concurrent CLI invocations.
    # Within a process, synchronous initialization also avoids the upstream
    # shared _init_done flag becoming visible before the schema is committed.
    with (Path(os.environ['TMPDIR']) / '.cache-init.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        connection = ENGINES_CACHE.DB
        # Check a write as well as schema loading on every invocation. Errors
        # must reach the caller rather than being swallowed by engine threads.
        connection.execute('SAVEPOINT byclaw_cache_probe')
        try:
            connection.execute('CREATE TABLE IF NOT EXISTS byclaw_cache_probe (value INTEGER)')
            connection.execute('INSERT INTO byclaw_cache_probe VALUES (1)')
        finally:
            connection.execute('ROLLBACK TO byclaw_cache_probe')
            connection.execute('RELEASE byclaw_cache_probe')

    from searxng_cli.cli import main as cli_main
    return cli_main()


if __name__ == '__main__':
    sys.exit(main())
