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
    values = accounts if accounts is not None else [account()]
    if len(values) != 1:
        raise ValueError("schema 2 projection contains exactly one account")
    connector_by_provider = {
        "qq": "qq-mail",
        "netease-163": "netease-163-mail",
        "gmail": "gmail-mail",
        "custom-imap": "custom-imap-mail",
    }
    connector = connector_by_provider[values[0]["provider"]]
    path = path.with_name(f"{connector}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schemaVersion": 2, "connectorCode": connector, "account": values[0]}),
        encoding="utf-8",
    )
    os.chmod(path, mode)
    return path
