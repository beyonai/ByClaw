from __future__ import annotations

import errno
import json
import os
import stat
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterable

from .mime import safe_filename
from .models import AttachmentDownloadResult, ErrorCode, MailRuntimeError


def _directory_flags() -> int:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise MailRuntimeError(ErrorCode.UNSUPPORTED)
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _file_flags() -> int:
    if not hasattr(os, "O_NOFOLLOW"):
        raise MailRuntimeError(ErrorCode.UNSUPPORTED)
    return os.O_RDONLY | os.O_NOFOLLOW


def _relative_parts(relative_path: Path | str) -> tuple[str, ...]:
    path = Path(relative_path)
    if path.is_absolute() or not path.parts:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    parts = tuple(path.parts)
    if any(part in {"", ".", ".."} for part in parts) or any(
        ord(character) < 32 or ord(character) == 127
        for part in parts
        for character in part
    ):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return parts


def relative_from_absolute(root: Path | str, target: Path | str) -> Path:
    trusted_root = Path(root)
    requested = Path(target)
    if not trusted_root.is_absolute() or not requested.is_absolute():
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    try:
        relative = requested.relative_to(trusted_root)
    except ValueError as exc:
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc
    _relative_parts(relative)
    return relative


def _absolute_root_parts(root: Path) -> tuple[str, ...]:
    if not root.is_absolute() or root.anchor != os.sep:
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    parts = tuple(part for part in root.parts if part != root.anchor)
    if any(part in {"", ".", ".."} for part in parts) or any(
        ord(character) < 32 or ord(character) == 127
        for part in parts
        for character in part
    ):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return parts


def _open_root(root: Path, missing_code: ErrorCode) -> int:
    current = -1
    try:
        current = os.open(os.sep, _directory_flags())
        for part in _absolute_root_parts(root):
            next_fd = os.open(part, _directory_flags(), dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except FileNotFoundError as exc:
        if current >= 0:
            os.close(current)
        raise MailRuntimeError(missing_code) from exc
    except MailRuntimeError:
        if current >= 0:
            os.close(current)
        raise
    except OSError as exc:
        if current >= 0:
            os.close(current)
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc


def _open_existing_directory(root_fd: int, parts: tuple[str, ...]) -> int:
    current = os.dup(root_fd)
    try:
        for part in parts:
            next_fd = os.open(part, _directory_flags(), dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except OSError as exc:
        os.close(current)
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc


class AnchoredPrivateReader:
    """Reads a private file relative to one trusted directory descriptor."""

    def __init__(self, trusted_root: Path | str, *, max_bytes: int) -> None:
        self.trusted_root = Path(trusted_root)
        self.max_bytes = max_bytes

    def read_bytes(
        self,
        relative_path: Path | str,
        *,
        missing_code: ErrorCode = ErrorCode.INVALID_REQUEST,
    ) -> bytes:
        parts = _relative_parts(relative_path)
        root_fd = _open_root(self.trusted_root, missing_code)
        parent_fd = -1
        file_fd = -1
        try:
            parent_fd = _open_existing_directory(root_fd, parts[:-1])
            try:
                file_fd = os.open(parts[-1], _file_flags(), dir_fd=parent_fd)
            except FileNotFoundError as exc:
                raise MailRuntimeError(missing_code) from exc
            except OSError as exc:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
            metadata = os.fstat(file_fd)
            if not stat.S_ISREG(metadata.st_mode):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if metadata.st_uid != os.geteuid():
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if stat.S_IMODE(metadata.st_mode) != 0o600:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if metadata.st_size <= 0 or metadata.st_size > self.max_bytes:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            chunks: list[bytes] = []
            remaining = self.max_bytes + 1
            while remaining:
                chunk = os.read(file_fd, min(8192, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
            if len(raw) > self.max_bytes:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            return raw
        finally:
            if file_fd >= 0:
                os.close(file_fd)
            if parent_fd >= 0:
                os.close(parent_fd)
            os.close(root_fd)

    def read_json(
        self,
        relative_path: Path | str,
        *,
        missing_code: ErrorCode = ErrorCode.INVALID_REQUEST,
    ) -> Any:
        raw = self.read_bytes(relative_path, missing_code=missing_code)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc


def _require_private_directory(metadata: os.stat_result) -> None:
    if not stat.S_ISDIR(metadata.st_mode):
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)


class AttachmentSink:
    """Anchored, exclusive attachment writer exposed to provider adapters."""

    def __init__(self, workspace_root: Path | str, output_directory: Path | str) -> None:
        self._workspace_root = Path(workspace_root)
        self._output_directory = Path(output_directory)
        self._relative = relative_from_absolute(self._workspace_root, self._output_directory)
        self._root_fd = -1
        self._directory_fd = -1
        self._root_identity: tuple[int, int] | None = None
        self._results: dict[int, tuple[AttachmentDownloadResult, int, int]] = {}

    def __enter__(self) -> "AttachmentSink":
        self._validate_workspace_parent()
        self._root_fd = _open_root(self._workspace_root, ErrorCode.PERMISSION_DENIED)
        try:
            root_metadata = os.fstat(self._root_fd)
            _require_private_directory(root_metadata)
            self._root_identity = (root_metadata.st_dev, root_metadata.st_ino)
            self._directory_fd = self._open_or_create_output(_relative_parts(self._relative))
            return self
        except Exception:
            self.close()
            raise

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        self.close()

    def close(self) -> None:
        if self._directory_fd >= 0:
            os.close(self._directory_fd)
            self._directory_fd = -1
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def _validate_workspace_parent(self) -> None:
        parent_fd = _open_root(self._workspace_root.parent, ErrorCode.PERMISSION_DENIED)
        try:
            metadata = os.fstat(parent_fd)
            if not stat.S_ISDIR(metadata.st_mode):
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if metadata.st_uid not in {0, os.geteuid()}:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if stat.S_IMODE(metadata.st_mode) & 0o022:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        finally:
            os.close(parent_fd)

    def _open_or_create_output(self, parts: tuple[str, ...]) -> int:
        current = os.dup(self._root_fd)
        try:
            for part in parts:
                next_fd = -1
                try:
                    try:
                        next_fd = os.open(part, _directory_flags(), dir_fd=current)
                    except FileNotFoundError:
                        os.mkdir(part, mode=0o700, dir_fd=current)
                        next_fd = os.open(part, _directory_flags(), dir_fd=current)
                    _require_private_directory(os.fstat(next_fd))
                except Exception:
                    if next_fd >= 0:
                        os.close(next_fd)
                    raise
                os.close(current)
                current = next_fd
            _require_private_directory(os.fstat(current))
            return current
        except (MailRuntimeError, OSError) as exc:
            os.close(current)
            if isinstance(exc, MailRuntimeError):
                raise
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc

    def _assert_still_anchored(self) -> None:
        if self._root_identity is None:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        fresh_root = _open_root(self._workspace_root, ErrorCode.PERMISSION_DENIED)
        reopened = -1
        try:
            root_metadata = os.fstat(fresh_root)
            if (root_metadata.st_dev, root_metadata.st_ino) != self._root_identity:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            _require_private_directory(root_metadata)
            reopened = _open_existing_directory(fresh_root, _relative_parts(self._relative))
            expected = os.fstat(self._directory_fd)
            actual = os.fstat(reopened)
            if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            _require_private_directory(actual)
        finally:
            if reopened >= 0:
                os.close(reopened)
            os.close(fresh_root)

    def _assert_leaf(self, filename: str, expected: os.stat_result) -> None:
        try:
            opened = os.open(filename, _file_flags(), dir_fd=self._directory_fd)
        except OSError as exc:
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc
        try:
            actual = os.fstat(opened)
            if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if not stat.S_ISREG(actual.st_mode) or actual.st_uid != os.geteuid():
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if stat.S_IMODE(actual.st_mode) != 0o600:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        finally:
            os.close(opened)

    def _unlink_if_same(self, filename: str, expected: os.stat_result) -> None:
        try:
            opened = os.open(filename, _file_flags(), dir_fd=self._directory_fd)
            try:
                actual = os.fstat(opened)
            finally:
                os.close(opened)
            if (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino):
                os.unlink(filename, dir_fd=self._directory_fd)
        except OSError:
            pass

    def write(
        self,
        filename: str,
        chunks: Iterable[bytes],
        *,
        content_type: str | None = None,
    ) -> AttachmentDownloadResult:
        if self._directory_fd < 0:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        safe_name = safe_filename(filename)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        file_fd = -1
        metadata: os.stat_result | None = None
        total = 0
        try:
            try:
                file_fd = os.open(safe_name, flags, 0o600, dir_fd=self._directory_fd)
            except OSError as exc:
                if exc.errno in {errno.EEXIST, errno.ELOOP, errno.EACCES, errno.EPERM}:
                    raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc
                raise MailRuntimeError(ErrorCode.INTERNAL_ERROR) from exc
            metadata = os.fstat(file_fd)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if stat.S_IMODE(metadata.st_mode) != 0o600:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            for chunk in chunks:
                if not isinstance(chunk, (bytes, bytearray, memoryview)):
                    raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
                view = memoryview(chunk)
                while view:
                    written = os.write(file_fd, view)
                    if written <= 0:
                        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
                    total += written
                    view = view[written:]
            os.fsync(file_fd)
            self._assert_still_anchored()
            self._assert_leaf(safe_name, metadata)
            result = AttachmentDownloadResult(safe_name, total, content_type)
            self._results[id(result)] = (result, metadata.st_dev, metadata.st_ino)
            return result
        except Exception:
            if metadata is not None:
                self._unlink_if_same(safe_name, metadata)
            raise
        finally:
            if file_fd >= 0:
                os.close(file_fd)

    def finalize(self, result: AttachmentDownloadResult) -> AttachmentDownloadResult:
        record = self._results.get(id(result))
        if record is None or record[0] is not result or result.path is not None:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        self._assert_still_anchored()
        try:
            opened = os.open(result.filename, _file_flags(), dir_fd=self._directory_fd)
        except OSError as exc:
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc
        try:
            actual = os.fstat(opened)
            if (actual.st_dev, actual.st_ino) != (record[1], record[2]):
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            if actual.st_size != result.size or stat.S_IMODE(actual.st_mode) != 0o600:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        finally:
            os.close(opened)
        return replace(result, path=str(self._output_directory / result.filename))
