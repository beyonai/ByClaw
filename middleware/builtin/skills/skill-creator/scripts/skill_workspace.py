"""Helpers that keep developed Skills inside this Skill's fixed workspace."""

import re
import shutil
import os
from pathlib import Path


SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9_-]+$")
AGENT_ID_ENV = "BYCLAW_AGENT_ID"
TRUSTED_AGENT_ID_ENV = "DSH_BYCLAW_AGENT_ID"
WORKSPACE_ROOT = Path(os.environ.get("OPENCLAW_STATE_DIR") or os.environ.get("DSH_HOME") or ".").resolve()


def _current_agent_id() -> str:
    """Return the platform-injected identity and reject model-controlled mismatches."""
    trusted = os.environ.get(TRUSTED_AGENT_ID_ENV, "").strip()
    supplied = os.environ.get(AGENT_ID_ENV, "").strip()
    if not AGENT_ID.fullmatch(trusted):
        raise ValueError(f"{TRUSTED_AGENT_ID_ENV} must contain a non-empty trusted agent ID")
    if supplied and supplied != trusted:
        raise ValueError(f"{AGENT_ID_ENV} does not match trusted {TRUSTED_AGENT_ID_ENV}")
    return trusted


def fixed_skills_root() -> Path:
    agent_id = _current_agent_id()
    return (WORKSPACE_ROOT / f"workspace-baiying-agent-{agent_id}" / "skills").resolve()


def validate_skill_name(name: str) -> str:
    if not isinstance(name, str) or not SKILL_NAME.fullmatch(name):
        raise ValueError("Skill name must contain only lowercase letters, digits, and hyphens")
    return name


def validate_output_root(path: Path) -> Path:
    requested = Path(path).expanduser().resolve()
    fixed = fixed_skills_root()
    if requested != fixed:
        raise ValueError(f"Skills must be created under the fixed directory: {fixed}")
    try:
        fixed.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ValueError(f"Unable to create the fixed Skills directory {fixed}: {error}") from error
    return fixed


def _reject_symlinks(directory: Path) -> None:
    for entry in directory.rglob("*"):
        if entry.is_symlink():
            raise ValueError(f"Skill source contains a symlink: {entry}")


def copy_skill_for_edit(source: Path, name: str, *, target_root: Path | None = None) -> Path:
    source = Path(source).expanduser().resolve()
    if not source.is_dir() or source.is_symlink():
        raise ValueError("Skill source must be a regular directory")
    if not (source / "SKILL.md").is_file():
        raise ValueError("Skill source must contain a root SKILL.md")
    _reject_symlinks(source)

    validate_skill_name(name)
    root = fixed_skills_root().resolve()
    if target_root is not None and Path(target_root).expanduser().resolve() != root.resolve():
        raise ValueError(f"Skills must be copied under the fixed directory: {root}")
    root.mkdir(parents=True, exist_ok=True)
    target = (root / name).resolve()
    if target.parent != root:
        raise ValueError("Skill target must be a direct child of the fixed directory")
    if target.exists():
        raise FileExistsError(f"Skill target already exists: {target}")
    shutil.copytree(source, target, symlinks=False)
    return target
