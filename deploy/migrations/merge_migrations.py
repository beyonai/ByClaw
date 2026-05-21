#!/usr/bin/env python3
"""
merge_migrations.py - 将 deploy/migrations/versions/ 下的增量脚本
自动区分 DDL/DML 后追加合并到 deploy/middleware/initdb/ 对应文件。

用法:
    python scripts/merge_migrations.py [--audit-db "host=... port=... dbname=... user=... password=..."] [--dry-run]
"""

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


SCRIPT_DIR = Path(__file__).resolve().parent
VERSIONS_DIR = SCRIPT_DIR / "versions"
INITDB_DIR = SCRIPT_DIR.parent / "middleware" / "initdb"
DDL_FILE = INITDB_DIR / "02_ddl.sql"
DML_FILE = INITDB_DIR / "04_dml.sql"
APPLIED_FILE = INITDB_DIR / ".applied"

BASELINE_PATTERN = re.compile(r".*__baseline\.sql$", re.IGNORECASE)

DDL_KEYWORDS = re.compile(
    r"^\s*(CREATE|ALTER|DROP|COMMENT\s+ON|GRANT|REVOKE|TRUNCATE)\b",
    re.IGNORECASE,
)
DML_KEYWORDS = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|MERGE)\b",
    re.IGNORECASE,
)
SET_KEYWORDS = re.compile(
    r"^\s*SET\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# SQL Statement Splitter
# ---------------------------------------------------------------------------

def split_statements(sql: str) -> list[str]:
    """Split SQL text into individual statements, respecting quotes, $$ blocks, and comments."""
    statements: list[str] = []
    current: list[str] = []
    i = 0
    n = len(sql)

    while i < n:
        ch = sql[i]

        # Single-line comment
        if ch == '-' and i + 1 < n and sql[i + 1] == '-':
            end = sql.find('\n', i)
            if end == -1:
                end = n
            current.append(sql[i:end])
            i = end
            continue

        # Block comment
        if ch == '/' and i + 1 < n and sql[i + 1] == '*':
            end = sql.find('*/', i + 2)
            if end == -1:
                end = n
            else:
                end += 2
            current.append(sql[i:end])
            i = end
            continue

        # Single-quoted string
        if ch == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                    j += 2  # escaped quote
                elif sql[j] == "'":
                    j += 1
                    break
                else:
                    j += 1
            current.append(sql[i:j])
            i = j
            continue

        # Dollar-quoted string ($$...$$, $tag$...$tag$)
        if ch == '$':
            match = re.match(r'\$([A-Za-z_]*)\$', sql[i:])
            if match:
                tag = match.group(0)
                end = sql.find(tag, i + len(tag))
                if end == -1:
                    end = n
                else:
                    end += len(tag)
                current.append(sql[i:end])
                i = end
                continue

        # Statement terminator
        if ch == ';':
            current.append(';')
            stmt = ''.join(current).strip()
            if stmt and stmt != ';':
                statements.append(stmt)
            current = []
            i += 1
            continue

        current.append(ch)
        i += 1

    # Remaining content without trailing semicolon
    remainder = ''.join(current).strip()
    if remainder:
        statements.append(remainder)

    return statements


# ---------------------------------------------------------------------------
# Statement Classifier
# ---------------------------------------------------------------------------

def classify_statement(stmt: str) -> str:
    """Classify a SQL statement as 'ddl', 'dml', or 'set'."""
    # Strip comments to find the first meaningful token
    lines = stmt.split('\n')
    effective = ""
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('--'):
            continue
        effective = stripped
        break

    if not effective:
        # Pure comment block - treat as context
        return "set"

    if SET_KEYWORDS.match(effective):
        return "set"
    if DDL_KEYWORDS.match(effective):
        return "ddl"
    if DML_KEYWORDS.match(effective):
        return "dml"

    # Default: treat as DDL (safer for schema changes)
    return "ddl"


# ---------------------------------------------------------------------------
# Applied Versions Tracking
# ---------------------------------------------------------------------------

def read_applied() -> set[str]:
    if not APPLIED_FILE.exists():
        return set()
    return set(
        line.strip()
        for line in APPLIED_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )


def write_applied(applied: set[str]) -> None:
    sorted_versions = sorted(applied)
    APPLIED_FILE.write_text(
        "\n".join(sorted_versions) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Version File Discovery
# ---------------------------------------------------------------------------

def discover_versions() -> list[Path]:
    """Find all migration version files, sorted by name, excluding baselines."""
    if not VERSIONS_DIR.exists():
        return []
    files = sorted(VERSIONS_DIR.glob("*.sql"))
    return [f for f in files if not BASELINE_PATTERN.match(f.name)]


# ---------------------------------------------------------------------------
# Merge Logic
# ---------------------------------------------------------------------------

def merge_one_version(
    version_file: Path,
    dry_run: bool = False,
) -> tuple[list[str], list[str]]:
    """Parse and classify statements from a version file.
    Returns (ddl_statements, dml_statements)."""
    content = version_file.read_text(encoding="utf-8")
    statements = split_statements(content)

    ddl_stmts: list[str] = []
    dml_stmts: list[str] = []
    set_stmts: list[str] = []

    for stmt in statements:
        category = classify_statement(stmt)
        if category == "ddl":
            ddl_stmts.append(stmt)
        elif category == "dml":
            dml_stmts.append(stmt)
        else:
            set_stmts.append(stmt)

    # Prepend SET statements to both DDL and DML sections if present
    if set_stmts:
        set_block = [s for s in set_stmts if s.rstrip(';').strip()]
        if ddl_stmts and set_block:
            ddl_stmts = set_block + ddl_stmts
        if dml_stmts and set_block:
            dml_stmts = set_block + dml_stmts

    return ddl_stmts, dml_stmts


def format_merge_block(version_name: str, statements: list[str]) -> str:
    """Format statements as a merge block with version header."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = f"\n-- ========== {version_name} (merged at {now}) ==========\n"
    body = "\n".join(s if s.endswith(";") else s + ";" for s in statements)
    return header + body + "\n"


def append_to_file(filepath: Path, content: str, dry_run: bool = False) -> None:
    if dry_run:
        return
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(content)


# ---------------------------------------------------------------------------
# Audit Checks
# ---------------------------------------------------------------------------

def audit_version_coverage(applied: set[str]) -> list[str]:
    """Check that all version files (except baseline) are in .applied."""
    issues = []
    all_versions = discover_versions()
    for v in all_versions:
        if v.name not in applied:
            issues.append(f"  MISSING: {v.name} not in .applied")
    return issues


def audit_sql_syntax(dsn: str) -> list[str]:
    """Dry-run merged SQL files against the database (BEGIN + ROLLBACK)."""
    issues = []
    try:
        import psycopg2
    except ImportError:
        issues.append("  SKIP: psycopg2 not installed, cannot run SQL syntax check")
        return issues

    conn = psycopg2.connect(dsn)
    conn.autocommit = False

    for label, filepath in [("DDL", DDL_FILE), ("DML", DML_FILE)]:
        try:
            cur = conn.cursor()
            cur.execute("BEGIN;")
            cur.execute(f"SET client_min_messages TO error;")
            sql = filepath.read_text(encoding="utf-8")
            cur.execute(sql)
            cur.execute("ROLLBACK;")
        except Exception as e:
            issues.append(f"  SYNTAX ERROR in {label} ({filepath.name}): {e}")
            try:
                conn.rollback()
            except Exception:
                pass

    conn.close()
    return issues


def audit_table_structure(dsn: str) -> list[str]:
    """Compare DDL file table definitions against actual database schema."""
    issues = []
    try:
        import psycopg2
    except ImportError:
        issues.append("  SKIP: psycopg2 not installed")
        return issues

    # Extract CREATE TABLE statements from DDL file
    ddl_content = DDL_FILE.read_text(encoding="utf-8")
    table_pattern = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:byai\.)?(\w+)\s*\(",
        re.IGNORECASE,
    )
    ddl_tables = set(table_pattern.findall(ddl_content))

    # Also extract ALTER TABLE ADD COLUMN
    alter_pattern = re.compile(
        r"ALTER\s+TABLE\s+(?:byai\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
        re.IGNORECASE,
    )
    expected_columns: dict[str, set[str]] = {}
    for table, col in alter_pattern.findall(ddl_content):
        expected_columns.setdefault(table, set()).add(col)

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    # Check tables exist
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'byai' AND table_type = 'BASE TABLE'
    """)
    db_tables = {row[0] for row in cur.fetchall()}

    missing_tables = ddl_tables - db_tables
    for t in sorted(missing_tables):
        issues.append(f"  TABLE MISSING in DB: byai.{t}")

    # Check ALTER TABLE ADD COLUMN columns exist
    for table, columns in sorted(expected_columns.items()):
        if table not in db_tables:
            continue
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'byai' AND table_name = %s
        """, (table,))
        db_cols = {row[0] for row in cur.fetchall()}
        for col in sorted(columns):
            if col not in db_cols:
                issues.append(f"  COLUMN MISSING: byai.{table}.{col}")

    conn.close()
    return issues


def audit_seed_data(dsn: str) -> list[str]:
    """Spot-check that tables referenced in DML have data."""
    issues = []
    try:
        import psycopg2
    except ImportError:
        issues.append("  SKIP: psycopg2 not installed")
        return issues

    dml_content = DML_FILE.read_text(encoding="utf-8")
    insert_pattern = re.compile(
        r"INSERT\s+INTO\s+(?:\"?byai\"?\.)?\"?(\w+)\"?",
        re.IGNORECASE,
    )
    tables = set(insert_pattern.findall(dml_content))

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    for table in sorted(tables):
        try:
            cur.execute(f'SELECT COUNT(*) FROM byai."{table}" LIMIT 1')
            count = cur.fetchone()[0]
            if count == 0:
                issues.append(f"  EMPTY TABLE: byai.{table} (DML has INSERT but table is empty)")
        except Exception as e:
            issues.append(f"  QUERY FAILED: byai.{table}: {e}")
            conn.rollback()

    conn.close()
    return issues


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Merge migration version scripts into initdb (DDL/DML separated)"
    )
    parser.add_argument(
        "--audit-db",
        help="Database connection string for audit checks (psycopg2 format)",
        default=None,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be merged without writing files",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  Migration Merge Tool")
    print("=" * 60)
    print()

    # Step 1: Read applied versions
    applied = read_applied()
    print(f"[INFO] Already applied: {len(applied)} version(s)")

    # Step 2: Discover pending versions
    all_versions = discover_versions()
    pending = [v for v in all_versions if v.name not in applied]

    if not pending:
        print("[INFO] No new versions to merge.")
    else:
        print(f"[INFO] Pending versions to merge: {len(pending)}")
        for v in pending:
            print(f"       - {v.name}")
        print()

    # Step 3: Merge each pending version
    total_ddl = 0
    total_dml = 0

    for version_file in pending:
        ddl_stmts, dml_stmts = merge_one_version(version_file, dry_run=args.dry_run)
        total_ddl += len(ddl_stmts)
        total_dml += len(dml_stmts)

        print(f"[MERGE] {version_file.name}: {len(ddl_stmts)} DDL, {len(dml_stmts)} DML")

        if args.dry_run:
            if ddl_stmts:
                print(f"        DDL statements:")
                for s in ddl_stmts[:3]:
                    preview = s[:80].replace('\n', ' ')
                    print(f"          {preview}...")
                if len(ddl_stmts) > 3:
                    print(f"          ... and {len(ddl_stmts) - 3} more")
            if dml_stmts:
                print(f"        DML statements:")
                for s in dml_stmts[:3]:
                    preview = s[:80].replace('\n', ' ')
                    print(f"          {preview}...")
                if len(dml_stmts) > 3:
                    print(f"          ... and {len(dml_stmts) - 3} more")
        else:
            if ddl_stmts:
                block = format_merge_block(version_file.stem, ddl_stmts)
                append_to_file(DDL_FILE, block)
            if dml_stmts:
                block = format_merge_block(version_file.stem, dml_stmts)
                append_to_file(DML_FILE, block)

            applied.add(version_file.name)
            write_applied(applied)

    if not args.dry_run and pending:
        print()
        print(f"[DONE] Merged {len(pending)} version(s): {total_ddl} DDL + {total_dml} DML statements")

    # Step 4: Audit checks
    print()
    print("-" * 60)
    print("  Audit Report")
    print("-" * 60)
    print()

    # 4.1 Version coverage (always runs)
    print("[AUDIT 1/4] Version coverage check...")
    issues = audit_version_coverage(applied)
    if issues:
        print("  FAIL:")
        for i in issues:
            print(i)
    else:
        print("  PASS: All versions accounted for in .applied")

    # 4.2-4.4 Database-dependent checks
    if args.audit_db:
        print()
        print("[AUDIT 2/4] SQL syntax check (dry-run against DB)...")
        issues = audit_sql_syntax(args.audit_db)
        if issues:
            print("  FAIL:")
            for i in issues:
                print(i)
        else:
            print("  PASS: SQL syntax valid")

        print()
        print("[AUDIT 3/4] Table structure consistency...")
        issues = audit_table_structure(args.audit_db)
        if issues:
            print("  WARN:")
            for i in issues:
                print(i)
        else:
            print("  PASS: All DDL tables/columns exist in database")

        print()
        print("[AUDIT 4/4] Seed data completeness...")
        issues = audit_seed_data(args.audit_db)
        if issues:
            print("  WARN:")
            for i in issues:
                print(i)
        else:
            print("  PASS: All DML tables have data")
    else:
        print("[AUDIT 2-4] Skipped (no --audit-db provided)")
        print("  To run full audit: --audit-db \"host=... port=... dbname=... user=... password=...\"")

    print()
    print("=" * 60)
    print("  Done.")
    print("=" * 60)


if __name__ == "__main__":
    main()
