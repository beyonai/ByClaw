from __future__ import annotations

import json
import os
from pathlib import Path


def account(account_id: str = "1001", provider: str = "qq") -> dict:
    return {
        "accountId": account_id,
        "provider": provider,
        "email": "person@example.com",
        "displayName": "Work",
        "default": True,
        "status": "CONNECTED",
        "locatorKey": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA",
        "capabilities": [
            "list",
            "get",
            "search",
            "downloadAttachment",
            "send",
            "reply",
            "delete",
        ],
        "auth": {"type": "APP_PASSWORD", "username": "person@example.com", "secret": "top-secret"},
        "server": {
            "imap": {"host": "imap.example.com", "port": 993, "encryption": "SSL"},
            "smtp": {"host": "smtp.example.com", "port": 465, "encryption": "SSL"},
        },
    }


def write_projection(path: Path, accounts: list[dict] | None = None, mode: int = 0o600) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schemaVersion": 1, "accounts": accounts if accounts is not None else [account()]}),
        encoding="utf-8",
    )
    os.chmod(path, mode)
    return path
