from __future__ import annotations


EXIT_ARGUMENT = 2
EXIT_DATABASE = 10
EXIT_POLICY = 11
EXIT_TRANSACTION = 12
EXIT_TIMEOUT = 13
EXIT_RUNTIME = 14
EXIT_UNKNOWN = 20


class DbCliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_DATABASE,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.retryable = retryable

    def payload(self) -> dict:
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
            },
        }


def invalid_argument(message: str) -> DbCliError:
    return DbCliError("INVALID_ARGUMENT", message, exit_code=EXIT_ARGUMENT)

