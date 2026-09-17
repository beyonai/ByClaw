from __future__ import annotations

import json
import os
import secrets
import socket
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

from dbcli.errors import DbCliError, EXIT_RUNTIME, EXIT_TRANSACTION


MAX_MESSAGE_BYTES = 16 * 1024 * 1024


def _receive(connection: socket.socket) -> dict[str, Any]:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = connection.recv(65_536)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_MESSAGE_BYTES:
            raise DbCliError("IPC_REQUEST_TOO_LARGE", "IPC request is too large", exit_code=EXIT_RUNTIME)
        chunks.append(chunk)
    return json.loads(b"".join(chunks).decode("utf-8"))


def request(socket_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.connect(socket_path)
        client.sendall(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        client.shutdown(socket.SHUT_WR)
        return _receive(client)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise DbCliError("DBCLI_UNAVAILABLE", "transaction host is unavailable", exit_code=EXIT_RUNTIME) from exc
    finally:
        client.close()


class TransactionServer:
    def __init__(self, handler: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
        self.handler = handler
        self.token = secrets.token_urlsafe(32)
        self.directory = Path(tempfile.mkdtemp(prefix="dbcli-transaction-"))
        os.chmod(self.directory, 0o700)
        self.socket_path = self.directory / "transaction.sock"
        self.failed = False
        self._closed = threading.Event()
        self._ready = threading.Event()
        self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> None:
        self._thread.start()
        if not self._ready.wait(timeout=3):
            raise DbCliError("DBCLI_UNAVAILABLE", "transaction IPC did not start", exit_code=EXIT_RUNTIME)

    def _serve(self) -> None:
        try:
            self._socket.bind(str(self.socket_path))
            os.chmod(self.socket_path, 0o600)
            self._socket.listen()
            self._socket.settimeout(0.2)
            self._ready.set()
            while not self._closed.is_set():
                try:
                    connection, _ = self._socket.accept()
                except TimeoutError:
                    continue
                with connection:
                    try:
                        payload = _receive(connection)
                        if not secrets.compare_digest(str(payload.get("token", "")), self.token):
                            raise DbCliError("TX_CONTEXT_INVALID", "invalid transaction context", exit_code=EXIT_TRANSACTION)
                        if self.failed:
                            raise DbCliError(
                                "TX_FAILED",
                                "transaction is already marked as failed",
                                exit_code=EXIT_TRANSACTION,
                            )
                        response = self.handler(payload)
                    except DbCliError as exc:
                        self.failed = True
                        response = exc.payload()
                        response["exitCode"] = exc.exit_code
                    except Exception:
                        self.failed = True
                        error = DbCliError("TX_FAILED", "transaction request failed", exit_code=EXIT_TRANSACTION)
                        response = error.payload()
                        response["exitCode"] = error.exit_code
                    connection.sendall(json.dumps(response, separators=(",", ":")).encode("utf-8"))
        finally:
            self._ready.set()

    def close(self) -> None:
        self._closed.set()
        self._socket.close()
        self._thread.join(timeout=2)
        try:
            self.socket_path.unlink(missing_ok=True)
            self.directory.rmdir()
        except OSError:
            pass
