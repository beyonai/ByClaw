"""Helpers to prefer local by-datacloud sources over the installed wheel."""

from __future__ import annotations

import sys
from pathlib import Path

from byclaw_data.runtime import resolve_by_datacloud_repo_root

_SOURCE_PACKAGES = (
    "datacloud_data_sdk",
    "datacloud_data_service",
    "datacloud_analysis",
    "datacloud_knowledge",
    "by_datacloud",
)


def activate_by_datacloud_sources() -> Path:
    """Prepend sibling by-datacloud ``src`` directories to ``sys.path``."""

    repo_root = resolve_by_datacloud_repo_root()
    src_paths = [
        repo_root / "packages" / "datacloud-data" / "src",
        repo_root / "packages" / "datacloud-analysis" / "src",
        repo_root / "packages" / "datacloud-knowledge" / "src",
    ]
    for src_path in reversed(src_paths):
        src_text = str(src_path)
        if src_path.is_dir() and src_text not in sys.path:
            sys.path.insert(0, src_text)

    _drop_installed_modules(repo_root)
    return repo_root


def _drop_installed_modules(repo_root: Path) -> None:
    repo_text = str(repo_root.resolve())
    for module_name in list(sys.modules):
        if not any(
            module_name == package_name or module_name.startswith(f"{package_name}.")
            for package_name in _SOURCE_PACKAGES
        ):
            continue
        module = sys.modules.get(module_name)
        module_file = str(getattr(module, "__file__", "") or "")
        if module_file and repo_text in module_file:
            continue
        del sys.modules[module_name]
