from __future__ import annotations

from datetime import date
import re
from urllib.parse import urlsplit

from groksearchcli.errors import invalid_argument


def normalize_domains(
    allowed: list[str], excluded: list[str]
) -> tuple[list[str], list[str]]:
    if allowed and excluded:
        raise invalid_argument("--allow-domain and --exclude-domain are mutually exclusive")
    if len(allowed) > 5 or len(excluded) > 5:
        raise invalid_argument("at most 5 allowed or excluded domains may be supplied")
    return [_normalize_domain(item) for item in allowed], [_normalize_domain(item) for item in excluded]


def _normalize_domain(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise invalid_argument("domain must not be empty")
    try:
        parsed = urlsplit(raw if "://" in raw else f"//{raw}")
        port = parsed.port
    except ValueError as exc:
        raise invalid_argument(f"invalid domain: {value}") from exc
    if parsed.username or parsed.password or port or parsed.query or parsed.fragment:
        raise invalid_argument(f"domain must be a hostname without credentials, port, query, or fragment: {value}")
    if parsed.path not in ("", "/"):
        raise invalid_argument(f"domain must not contain a path: {value}")
    hostname = parsed.hostname
    if not hostname or " " in hostname or "." not in hostname:
        raise invalid_argument(f"invalid domain: {value}")
    return hostname.lower()


def normalize_handles(
    allowed: list[str], excluded: list[str]
) -> tuple[list[str], list[str]]:
    if allowed and excluded:
        raise invalid_argument("--allow-handle and --exclude-handle are mutually exclusive")
    if len(allowed) > 20 or len(excluded) > 20:
        raise invalid_argument("at most 20 allowed or excluded handles may be supplied")
    return [_normalize_handle(item) for item in allowed], [_normalize_handle(item) for item in excluded]


def _normalize_handle(value: str) -> str:
    handle = value.strip().removeprefix("@")
    if not re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle):
        raise invalid_argument(f"invalid X handle: {value}")
    return handle


def validate_dates(from_date: str | None, to_date: str | None) -> None:
    for value in (from_date, to_date):
        if value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise invalid_argument("dates must use YYYY-MM-DD format")
    try:
        start = date.fromisoformat(from_date) if from_date else None
        end = date.fromisoformat(to_date) if to_date else None
    except ValueError as exc:
        raise invalid_argument("dates must use YYYY-MM-DD format") from exc
    if start and end and start > end:
        raise invalid_argument("--from-date must be earlier than or equal to --to-date")


def duration_seconds(value: str) -> float:
    units = {"ms": 0.001, "s": 1.0, "m": 60.0}
    for suffix, multiplier in units.items():
        if value.endswith(suffix):
            try:
                amount = float(value[: -len(suffix)])
            except ValueError as exc:
                raise invalid_argument("invalid duration") from exc
            if amount <= 0:
                raise invalid_argument("duration must be positive")
            return amount * multiplier
    try:
        amount = float(value)
    except ValueError as exc:
        raise invalid_argument("invalid duration") from exc
    if amount <= 0:
        raise invalid_argument("duration must be positive")
    return amount
