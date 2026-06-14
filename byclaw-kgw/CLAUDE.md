# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Setup (first time)

```bash
cd byclaw-kgw
uv venv
uv sync --group dev
```

Pre-commit runs automatically on `git commit` via husky (no `pre-commit install` needed).
