from __future__ import annotations


EXIT_ARGUMENT = 2
EXIT_RESOURCE = 3
EXIT_SCHEMA = 4
EXIT_AUTH = 5
EXIT_POLICY = 11
EXIT_TIMEOUT = 13
EXIT_RUNTIME = 14
EXIT_CANCELLED = 15


class CallCliError(Exception):
    def __init__(self, code: str, message: str, *, exit_code: int = EXIT_RUNTIME,
                 retryable: bool = False, details: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.retryable = retryable
        self.details = details

    def payload(self, operation: str | None = None) -> dict:
        error = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.details is not None:
            error["details"] = self.details
        out = {"ok": False, "error": error}
        if operation:
            out["operation"] = operation
        return out


def invalid_argument(message: str) -> CallCliError:
    return CallCliError("INVALID_ARGUMENT", message, exit_code=EXIT_ARGUMENT)

