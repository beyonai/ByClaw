from __future__ import annotations

from .models import ErrorCode, MailRuntimeError


def safe_filename(value: str, *, maximum: int = 240) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if value in {".", ".."} or "/" in value or "\\" in value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    cleaned = value.strip()
    if not cleaned or cleaned in {".", ".."}:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return cleaned


def normalize_body(value: str) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    for character in value:
        code = ord(character)
        if (code < 32 and character not in "\t\r\n") or code == 127:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value.replace("\r\n", "\n").replace("\r", "\n")
