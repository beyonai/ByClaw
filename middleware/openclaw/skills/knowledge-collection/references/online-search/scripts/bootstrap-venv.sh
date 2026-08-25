#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
venv_dir="${script_dir}/.venv"

if command -v python3.12 >/dev/null 2>&1; then
  python_bin="$(command -v python3.12)"
elif command -v python3 >/dev/null 2>&1 \
  && python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
  python_bin="$(command -v python3)"
else
  printf '%s\n' '需要 Python 3.12 或更高版本，无法创建 online-search 虚拟环境。' >&2
  exit 1
fi

"${python_bin}" -m venv "${venv_dir}"
"${venv_dir}/bin/python" -m pip install --requirement "${script_dir}/requirements.txt"
"${venv_dir}/bin/python" -c 'import flask, httpx, lxml, msgspec, typer, yaml'

printf 'online-search 虚拟环境已就绪：%s\n' "${venv_dir}/bin/python"
