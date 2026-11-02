# ByClaw Python CLIs

This directory contains the source packages for the Python command-line tools
shipped in the ByClaw Harness image.

| Package | Command | Purpose |
| --- | --- | --- |
| `kbcli` | `kbcli` | Service-discovered knowledge-base operations |
| `groksearchcli` | `groksearchcli` | Grok Web and X search |
| `callcli` | `callcli` | Service-discovered capability invocation |
| `dbcli` | `dbcli` | Session-scoped SQL execution |

For local development, install the packages into one virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install \
  "by-framework==0.2.2.dev10" \
  -e ./builtin/python-clis/kbcli \
  -e ./builtin/python-clis/groksearchcli \
  -e ./builtin/python-clis/callcli \
  -e "./builtin/python-clis/dbcli[all]"
```

Generated directories such as `.venv`, `build`, `dist`, `*.egg-info`, and
`__pycache__` are intentionally excluded from the repository.
