from __future__ import annotations

from pathlib import Path

from .io_security import AnchoredPrivateReader
from .models import AccountConfig, ErrorCode, MailRuntimeError


DEFAULT_CONFIG_ROOT = Path("/by/.connector-auth/.mail")
MAX_PROJECTION_BYTES = 64 * 1024
CONNECTOR_PROJECTIONS = {
    "qq-mail.json": ("qq-mail", "qq"),
    "netease-163-mail.json": ("netease-163-mail", "netease-163"),
    "gmail-mail.json": ("gmail-mail", "gmail"),
    "custom-imap-mail.json": ("custom-imap-mail", "custom-imap"),
}


class AccountProjectionReader:
    def __init__(self, trusted_root: Path | str = DEFAULT_CONFIG_ROOT) -> None:
        self.trusted_root = Path(trusted_root)

    def read(self) -> tuple[AccountConfig, ...]:
        reader = AnchoredPrivateReader(self.trusted_root, max_bytes=MAX_PROJECTION_BYTES)
        accounts: list[AccountConfig] = []
        for filename, (connector_code, provider) in CONNECTOR_PROJECTIONS.items():
            try:
                document = reader.read_json(filename, missing_code=ErrorCode.AUTH_REQUIRED)
            except MailRuntimeError as exc:
                if exc.code == ErrorCode.AUTH_REQUIRED:
                    continue
                raise
            if (
                not isinstance(document, dict)
                or set(document) != {"schemaVersion", "connectorCode", "account"}
                or document.get("schemaVersion") != 2
                or document.get("connectorCode") != connector_code
            ):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            account = AccountConfig.from_mapping(document.get("account"))
            if account.provider != provider:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            accounts.append(account)
        if not accounts:
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
        account_ids = [item.account_id for item in accounts]
        if len(account_ids) != len(set(account_ids)):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return tuple(accounts)
