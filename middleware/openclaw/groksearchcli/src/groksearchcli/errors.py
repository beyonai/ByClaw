from __future__ import annotations


EXIT_ARGUMENT = 2
EXIT_POLICY = 11
EXIT_TIMEOUT = 13
EXIT_RUNTIME = 14


class GrokSearchCliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_RUNTIME,
        retryable: bool = False,
        details: object | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.retryable = retryable
        self.details = details

    def payload(self) -> dict:
        error: dict = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details is not None:
            error["details"] = self.details
        return {"ok": False, "error": error}


def invalid_argument(message: str) -> GrokSearchCliError:
    return GrokSearchCliError("INVALID_ARGUMENT", message, exit_code=EXIT_ARGUMENT)
