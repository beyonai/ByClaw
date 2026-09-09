from __future__ import annotations

from pathlib import Path

from .io_security import AnchoredPrivateReader
from .models import AccountConfig, ErrorCode, MailRuntimeError


DEFAULT_CONFIG_ROOT = Path("/by/.connector-auth/.mail")
MAX_PROJECTION_BYTES = 64 * 1024


class AccountProjectionReader:
    def __init__(self, trusted_root: Path | str = DEFAULT_CONFIG_ROOT) -> None:
        self.trusted_root = Path(trusted_root)

    def read(self) -> tuple[AccountConfig, ...]:
        document = AnchoredPrivateReader(
            self.trusted_root,
            max_bytes=MAX_PROJECTION_BYTES,
        ).read_json("accounts.json", missing_code=ErrorCode.AUTH_REQUIRED)
        if not isinstance(document, dict) or document.get("schemaVersion") != 1:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        raw_accounts = document.get("accounts")
        if not isinstance(raw_accounts, list):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        accounts = tuple(AccountConfig.from_mapping(item) for item in raw_accounts)
        account_ids = [item.account_id for item in accounts]
        if len(account_ids) != len(set(account_ids)):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return accounts
