#!/usr/bin/env python3
"""
merge_migrations.py - 将 deploy/migrations/versions/ 下各版本目录中预拆好的
DDL/DML 增量脚本，按语义化版本顺序追加合并到 deploy/middleware/initdb/ 对应文件。

目录结构（每个版本一个子目录）：
    versions/V0.0.1/V0.0.1__ddl.sql              -> 合并进 02_ddl.sql
    versions/V0.0.1/V0.0.1__dml.sql              -> 合并进 04_dml.sql
    versions/V0.0.1/V0.0.1-alpha__baseline__*.sql -> 基线全量快照，跳过

版本排序遵循语义化版本：major.minor.patch，预发布 alpha < beta < rc < 正式版，
同类预发布按序号比较（alpha.2 < alpha.10）。

用法:
    python merge_migrations.py [--audit-db "host=... port=... dbname=... user=... password=..."] [--dry-run]
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
VERSIONS_DIR = SCRIPT_DIR / "versions"
INITDB_DIR = SCRIPT_DIR.parent / "middleware" / "initdb"
DDL_FILE = INITDB_DIR / "02_ddl.sql"
DML_FILE = INITDB_DIR / "04_dml.sql"
APPLIED_FILE = SCRIPT_DIR / ".applied"


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
# Version Discovery & Ordering
# ---------------------------------------------------------------------------

# 每个版本是 versions/ 下的一个子目录，目录名形如：
#   V0.0.1              正式版
#   V0.1.0-alpha.2      预发布版（alpha/beta/rc + 序号）
# 目录内的迁移文件已手工预拆为：
#   <版本>__ddl.sql / <版本>__dml.sql        —— 需要合并的增量
#   *__baseline__ddl.sql / *__baseline__dml.sql —— 基线全量快照，跳过
VERSION_DIR_PATTERN = re.compile(r"^V\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")
BASELINE_FILE_PATTERN = re.compile(r".*__baseline__(ddl|dml)\.sql$", re.IGNORECASE)
DDL_FILE_PATTERN = re.compile(r".*__ddl\.sql$", re.IGNORECASE)
DML_FILE_PATTERN = re.compile(r".*__dml\.sql$", re.IGNORECASE)

# 预发布标识排序权重：alpha < beta < rc < 正式版
_PRERELEASE_RANK = {"alpha": 0, "beta": 1, "rc": 2}


class Version:
    """一个版本目录及其预拆的 ddl/dml 文件。"""

    def __init__(self, directory: Path):
        self.directory = directory
        self.name = directory.name  # 如 V0.1.0-alpha.2
        self.sort_key = parse_version_sort_key(self.name)
        self.ddl_files: list[Path] = []
        self.dml_files: list[Path] = []
        for f in sorted(directory.glob("*.sql")):
            if BASELINE_FILE_PATTERN.match(f.name):
                continue  # 跳过 baseline 全量快照
            if DDL_FILE_PATTERN.match(f.name):
                self.ddl_files.append(f)
            elif DML_FILE_PATTERN.match(f.name):
                self.dml_files.append(f)


def parse_version_sort_key(name: str):
    """把版本目录名解析成可比较的排序键。

    规则（语义化版本）：
      - 主体按 major.minor.patch 数字比较；
      - 预发布版排在同主体的正式版之前（V1.0.0-alpha < V1.0.0）；
      - 预发布之间 alpha < beta < rc，同类按数字序号比较（alpha.2 < alpha.10）。

    返回元组：(major, minor, patch, is_release, prerelease_rank, prerelease_num)
      is_release=1 表示正式版（排在预发布之后）。
    """
    raw = name[1:] if name.startswith(("V", "v")) else name
    core, _, pre = raw.partition("-")

    parts = core.split(".")
    nums = []
    for i in range(3):
        try:
            nums.append(int(parts[i]) if i < len(parts) else 0)
        except ValueError:
            nums.append(0)
    major, minor, patch = nums[0], nums[1], nums[2]

    if not pre:
        # 正式版：排在所有预发布之后
        return (major, minor, patch, 1, 0, 0)

    # 预发布：如 alpha / alpha.2 / beta.1 / rc.3
    pre_parts = pre.split(".")
    label = pre_parts[0].lower()
    rank = _PRERELEASE_RANK.get(label, 99)
    seq = 0
    for token in pre_parts[1:]:
        if token.isdigit():
            seq = int(token)
            break
    return (major, minor, patch, 0, rank, seq)


def discover_versions() -> list["Version"]:
    """发现所有版本目录，按语义化版本排序；不含可合并文件的目录会被忽略。"""
    if not VERSIONS_DIR.exists():
        return []
    versions = []
    for entry in VERSIONS_DIR.iterdir():
        if not entry.is_dir():
            continue
        if not VERSION_DIR_PATTERN.match(entry.name):
            continue
        version = Version(entry)
        if not version.ddl_files and not version.dml_files:
            continue  # 只有 baseline 或空目录，无增量可合并
        versions.append(version)
    versions.sort(key=lambda v: v.sort_key)
    return versions


# ---------------------------------------------------------------------------
# Layout Validation
# ---------------------------------------------------------------------------

# 版本目录内允许的文件名后缀（{版本} 由所在目录名校验）：
#   {版本}__ddl.sql / {版本}__dml.sql
#   {版本}__baseline__ddl.sql / {版本}__baseline__dml.sql
_ALLOWED_SUFFIXES = ("__ddl.sql", "__dml.sql", "__baseline__ddl.sql", "__baseline__dml.sql")


def validate_layout() -> list[str]:
    """校验 versions/ 目录结构与命名规范，返回错误列表（空表示通过）。

    规则：
      1. versions/ 下只能是版本目录，不能有散落文件；
      2. 目录名必须匹配 V{major}.{minor}.{patch}[-prerelease]（如 V0.1.0、V0.1.0-alpha.2）；
      3. 目录内文件必须是 {目录名}[-...]__ddl.sql / __dml.sql / __baseline__{ddl,dml}.sql，
         且文件名的版本前缀必须与所在目录一致。
    """
    errors: list[str] = []
    if not VERSIONS_DIR.exists():
        return [f"versions 目录不存在: {VERSIONS_DIR}"]

    for entry in sorted(VERSIONS_DIR.iterdir()):
        rel = entry.name
        if entry.is_file():
            errors.append(f"versions/ 下不应有文件: {rel}（迁移脚本须放在版本目录内）")
            continue
        if not entry.is_dir():
            continue
        if not VERSION_DIR_PATTERN.match(rel):
            errors.append(
                f"版本目录名不规范: {rel}（应形如 V0.1.0 或 V0.1.0-alpha.2，"
                f"需 V 前缀 + major.minor.patch）"
            )
            continue  # 目录名都不对，不再校验内部文件

        sql_files = list(entry.glob("*.sql"))
        if not sql_files:
            errors.append(f"{rel}/ 为空，没有任何 .sql 文件")
        for f in sorted(entry.iterdir()):
            if f.is_dir():
                errors.append(f"{rel}/ 下不应有子目录: {f.name}")
                continue
            if not f.name.endswith(".sql"):
                errors.append(f"{rel}/{f.name} 不是 .sql 文件")
                continue
            # 文件名须为 {目录名}<可选 -prerelease> + 允许的后缀
            matched_suffix = next((s for s in _ALLOWED_SUFFIXES if f.name.endswith(s)), None)
            if matched_suffix is None:
                errors.append(
                    f"{rel}/{f.name} 文件名后缀不规范"
                    f"（应以 __ddl.sql / __dml.sql / __baseline__ddl.sql / __baseline__dml.sql 结尾）"
                )
                continue
            prefix = f.name[: -len(matched_suffix)]
            # 前缀须以目录名开头（baseline 允许形如 V0.0.1-alpha 的预发布后缀）
            if prefix != rel and not prefix.startswith(rel + "-"):
                errors.append(
                    f"{rel}/{f.name} 版本前缀与目录不一致"
                    f"（前缀 '{prefix}' 应为 '{rel}' 或 '{rel}-<prerelease>'）"
                )
    return errors


# ---------------------------------------------------------------------------
# Merge Logic
# ---------------------------------------------------------------------------

def read_version_sql(version: "Version") -> tuple[str, str]:
    """读取一个版本预拆好的 DDL / DML 原文（不做语句拆分/分类）。

    新结构下每个版本目录已手工分好 __ddl.sql / __dml.sql，
    脚本只需原样读取并追加，无需再 split/classify。
    返回 (ddl_text, dml_text)，缺失的部分为空串。
    """
    def _read_all(files: list[Path]) -> str:
        chunks = []
        for f in files:
            text = f.read_text(encoding="utf-8").strip()
            if text:
                chunks.append(text)
        return "\n\n".join(chunks)

    return _read_all(version.ddl_files), _read_all(version.dml_files)


def format_merge_block(version_name: str, body: str) -> str:
    """Format a version's SQL text as a merge block with version header."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = f"\n-- ========== {version_name} (merged at {now}) ==========\n"
    body = body.strip()
    if body and not body.endswith(";"):
        body += "\n"
    return header + body + "\n"


def version_already_in_file(filepath: Path, version_name: str) -> bool:
    """Check if a version's merge marker already exists in the target file."""
    if not filepath.exists():
        return False
    marker = f"-- ========== {version_name} ("
    content = filepath.read_text(encoding="utf-8")
    return marker in content


def append_to_file(filepath: Path, content: str, dry_run: bool = False) -> None:
    if dry_run:
        return
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(content)


# ---------------------------------------------------------------------------
# Audit Checks
# ---------------------------------------------------------------------------

def audit_version_coverage(applied: set[str]) -> list[str]:
    """Check that all discovered versions are recorded in .applied."""
    issues = []
    for v in discover_versions():
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

    # Step 0: Validate layout & naming before doing anything.
    print("[STEP 0] Validating versions/ layout...")
    layout_errors = validate_layout()
    if layout_errors:
        print(f"  FAIL: {len(layout_errors)} issue(s) found:")
        for e in layout_errors:
            print(f"    - {e}")
        print()
        print("[ABORT] 请修复以上目录/命名问题后重试。")
        sys.exit(1)
    print("  PASS: layout OK")
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
    merged_count = 0

    for version in pending:
        ddl_text, dml_text = read_version_sql(version)
        has_ddl = bool(ddl_text.strip())
        has_dml = bool(dml_text.strip())

        print(f"[MERGE] {version.name}: "
              f"{'DDL' if has_ddl else 'no-ddl'}, {'DML' if has_dml else 'no-dml'}")

        if args.dry_run:
            for label, text in (("DDL", ddl_text), ("DML", dml_text)):
                if text.strip():
                    preview = text.strip().splitlines()[0][:80]
                    line_count = len(text.strip().splitlines())
                    print(f"        {label}: {line_count} line(s), starts: {preview}")
            continue

        # Guard against .applied being deleted: skip if already merged into targets.
        already_in_ddl = version_already_in_file(DDL_FILE, version.name)
        already_in_dml = version_already_in_file(DML_FILE, version.name)
        if already_in_ddl or already_in_dml:
            print(f"[SKIP] {version.name}: already present in target file(s), recovering .applied")
            applied.add(version.name)
            write_applied(applied)
            continue

        if has_ddl:
            append_to_file(DDL_FILE, format_merge_block(version.name, ddl_text))
        if has_dml:
            append_to_file(DML_FILE, format_merge_block(version.name, dml_text))

        applied.add(version.name)
        write_applied(applied)
        merged_count += 1

    if not args.dry_run and pending:
        print()
        print(f"[DONE] Merged {merged_count} version(s) into {DDL_FILE.name} / {DML_FILE.name}")

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
