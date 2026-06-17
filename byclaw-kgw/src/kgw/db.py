"""PostgreSQL / OpenGauss async connection pool and migration runner.

Mirrors byclaw-qa's ``by_qa/knowledge_base/infrastructure/database.py``
style: psycopg async with ``dict_row``. Migrations are numbered SQL
files applied in lexical order; applied filenames are recorded in
``kgw_migration`` to make startup idempotent.
"""

from __future__ import annotations

from pathlib import Path

from kgw.observability.logger import get_logger
from psycopg.rows import dict_row
from psycopg.sql import SQL, Identifier
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)

_MIGRATION_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS kgw_migration (
    filename     VARCHAR(256) PRIMARY KEY,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""


async def build_pool(
    dsn: str,
    *,
    min_size: int = 1,
    max_size: int = 10,
) -> AsyncConnectionPool:
    """Create and open an async connection pool with dict-row factory."""
    pool = AsyncConnectionPool(
        conninfo=dsn,
        min_size=min_size,
        max_size=max_size,
        open=False,
        kwargs={"row_factory": dict_row, "autocommit": False},
    )
    await pool.open()
    await pool.wait()
    _log.info("db.pool.opened", min_size=min_size, max_size=max_size)
    return pool


async def run_migrations(
    pool: AsyncConnectionPool, sql_dir: Path, *, schema: str = ""
) -> list[str]:
    """Apply each ``NNN_*.sql`` in ``sql_dir`` once; return newly applied names.

    If *schema* is non-empty, ``CREATE SCHEMA IF NOT EXISTS`` is issued
    before migrations so that the search_path target always exists.

    Files not matching ``*.sql`` (case-insensitive suffix) are ignored, regardless of name prefix. Files are
    applied in lexical order of filename. Each migration is a single
    transaction; failure aborts startup.
    """
    sql_dir = Path(sql_dir)
    if not sql_dir.is_dir():
        raise FileNotFoundError(f"sql_dir not found: {sql_dir}")

    files = sorted(p for p in sql_dir.iterdir() if p.suffix.lower() == ".sql")

    async with pool.connection() as conn:
        if schema:
            await conn.execute(
                SQL("CREATE SCHEMA IF NOT EXISTS {}").format(Identifier(schema))
            )
        await conn.execute(_MIGRATION_TABLE_DDL)
        # Read already-applied files in the same transaction as DDL creation.
        cur = await conn.execute("SELECT filename FROM kgw_migration")
        already = {row["filename"] for row in await cur.fetchall()}
        # conn.__aexit__ commits both the DDL and the read.

    newly_applied: list[str] = []
    for path in files:
        if path.name in already:
            continue
        sql = path.read_text(encoding="utf-8")
        async with pool.connection() as conn:
            try:
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO kgw_migration (filename) VALUES (%s)",
                    (path.name,),
                )
                await conn.commit()
            except Exception:
                await conn.rollback()
                _log.error("db.migration.failed", filename=path.name)
                raise
        newly_applied.append(path.name)
        _log.info("db.migration.applied", filename=path.name)

    return newly_applied
