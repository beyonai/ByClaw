#!/usr/bin/env python3
"""Local Node-side simulation for the V0.5.0 tenant DB handoff.

Run after BE has provisioned tenant DB sandboxes. This reads the same Redis
snapshot a tenant Node would read, connects with the tenant credential, applies
the versioned DDL, and checks the catalog plus committed SQL CRUD. It does not
mark the tenant READY or write a platform schema audit result: those belong to
the actual tenant Node/BE callback workflow.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import hmac
import json
import re
import subprocess
from pathlib import Path

import psycopg2
import redis


ROOT = Path(__file__).resolve().parents[2]
DDL = ROOT / "deploy/migrations/versions/V0.5.0/tenant/V0.5.0__baseline__ddl.sql"
SM4_SOURCE = ROOT / "byclaw-be/src/main/java/com/iwhalecloud/byai/common/ecrypt/Sm4Util.java"
TABLES = (
    "byai_session", "byai_session_ext", "byai_session_member", "byai_session_workspace",
    "byai_message", "byai_message_relobj", "byai_group_chat_execution",
    "byai_group_chat_execution_event", "byai_group_chat_task",
    "byai_group_chat_task_publication", "byai_group_chat_mention",
    "byai_group_chat_turn", "byai_group_chat_pending_publication", "byai_group_chat_topic",
)


def load_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"').strip("'")
    return values


def decode_url(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def decrypt_envelope(enterprise_id: int, database: str, envelope_json: str) -> str:
    """Use OpenSSL's SM4-GCM independently of the BE implementation."""
    source = SM4_SOURCE.read_text()
    match = re.search(r'DEFAULT_KEY_HEX\s*=\s*"([0-9a-fA-F]{32})"', source)
    if not match:
        raise RuntimeError("ByClaw SM4 key source was not found")
    master = bytes.fromhex(match.group(1))
    key = hmac.new(master, f"byclaw:tenant-db-credential:v1:{enterprise_id}".encode(), hashlib.sha256).digest()[:16]
    envelope = json.loads(envelope_json)
    if envelope.get("alg") != "SM4-GCM" or envelope.get("keyId") != "byclaw-sm4-v1":
        raise RuntimeError("tenant credential envelope identity mismatch")
    nonce, ciphertext, tag = (decode_url(envelope[field]) for field in ("nonce", "ciphertext", "tag"))
    if len(nonce) != 12 or len(tag) != 16:
        raise RuntimeError("invalid tenant credential envelope")
    aad = f"byclaw:tenant-db:v1:{enterprise_id}:{database}".encode()

    crypto = ctypes.CDLL("/opt/homebrew/opt/openssl@3/lib/libcrypto.dylib")
    crypto.EVP_CIPHER_fetch.argtypes = (ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p)
    crypto.EVP_CIPHER_fetch.restype = ctypes.c_void_p
    crypto.EVP_CIPHER_free.argtypes = (ctypes.c_void_p,)
    crypto.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
    crypto.EVP_CIPHER_CTX_free.argtypes = (ctypes.c_void_p,)
    crypto.EVP_DecryptInit_ex.argtypes = (
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
    )
    crypto.EVP_DecryptUpdate.argtypes = (
        ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.c_void_p, ctypes.c_int,
    )
    crypto.EVP_CIPHER_CTX_ctrl.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p)
    crypto.EVP_DecryptFinal_ex.argtypes = (
        ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int),
    )
    cipher = crypto.EVP_CIPHER_fetch(None, b"SM4-GCM", None)
    context = crypto.EVP_CIPHER_CTX_new()
    if not cipher or not context:
        raise RuntimeError("OpenSSL SM4-GCM is unavailable")
    try:
        key_buf, nonce_buf = ctypes.create_string_buffer(key), ctypes.create_string_buffer(nonce)
        aad_buf, cipher_buf, tag_buf = (
            ctypes.create_string_buffer(aad), ctypes.create_string_buffer(ciphertext), ctypes.create_string_buffer(tag)
        )
        plain = ctypes.create_string_buffer(len(ciphertext) + 16)
        length = ctypes.c_int()
        final = ctypes.c_int()
        if crypto.EVP_DecryptInit_ex(context, cipher, None, key_buf, nonce_buf) != 1:
            raise RuntimeError("SM4-GCM initialization failed")
        if crypto.EVP_DecryptUpdate(context, None, ctypes.byref(length), aad_buf, len(aad)) != 1:
            raise RuntimeError("SM4-GCM AAD failed")
        if crypto.EVP_DecryptUpdate(context, plain, ctypes.byref(length), cipher_buf, len(ciphertext)) != 1:
            raise RuntimeError("SM4-GCM decryption failed")
        count = length.value
        if crypto.EVP_CIPHER_CTX_ctrl(context, 0x11, len(tag), tag_buf) != 1:
            raise RuntimeError("SM4-GCM tag setup failed")
        if crypto.EVP_DecryptFinal_ex(context, ctypes.byref(plain, count), ctypes.byref(final)) != 1:
            raise RuntimeError("tenant credential authentication failed")
        return plain.raw[: count + final.value].decode()
    finally:
        crypto.EVP_CIPHER_CTX_free(context)
        crypto.EVP_CIPHER_free(cipher)


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def verify_tenant(enterprise_id: int, platform, cache, ddl: str, sandbox_container: str) -> None:
    with platform.cursor() as cursor:
        cursor.execute(
            "SELECT params_code, params_value FROM byai.tenant_config WHERE enterprise_id=%s", (enterprise_id,)
        )
        config = dict(cursor.fetchall())
        if not config:
            raise RuntimeError(f"tenant {enterprise_id}: BE has no tenant configuration")
        record_id = int(config["DB_SANDBOX_RECORD_ID"])
        cursor.execute(
            "SELECT owner_scope, enterprise_id, status, sandbox_id, auto_release, lease_policy "
            "FROM byai.ss_sandbox_record WHERE id=%s", (record_id,)
        )
        record = cursor.fetchone()
    if not record or record[:3] != ("TENANT", enterprise_id, "RUNNING") or record[4:] != (0, "MANUAL"):
        raise RuntimeError(f"tenant {enterprise_id}: DB sandbox record is not a persistent RUNNING tenant resource")
    snapshot = cache.hgetall(f"TENANT_CONFIG_{enterprise_id}")
    required = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SANDBOX_RECORD_ID", "PROVISION_STATE")
    if any(not snapshot.get(key) or snapshot[key] != config.get(key) for key in required):
        raise RuntimeError(f"tenant {enterprise_id}: Redis snapshot differs from BE configuration")
    state = json.loads(snapshot["PROVISION_STATE"])
    if state.get("status") not in ("REDIS_PUBLISHED", "READY"):
        raise RuntimeError(f"tenant {enterprise_id}: BE DB provisioning is incomplete")
    if config.get("PROVISION_FAILURE_REASON"):
        raise RuntimeError(f"tenant {enterprise_id}: BE still records a provisioning failure")
    host = snapshot["DB_HOST"]
    if not host.startswith(f"tenant-db-{enterprise_id}-") or int(snapshot["DB_PORT"]) != 5432:
        raise RuntimeError(f"tenant {enterprise_id}: DB_HOST is not the tenant container identity")
    sandbox_id = record[3]
    if host != f"tenant-db-{enterprise_id}-{sandbox_id.replace('-', '')}":
        raise RuntimeError(f"tenant {enterprise_id}: DB_HOST does not match the sandbox record")
    if run(["podman", "inspect", "--format", "{{.State.Running}}", host]) != "true":
        raise RuntimeError(f"tenant {enterprise_id}: DB container is not running")
    if not run(["podman", "exec", sandbox_container, "getent", "hosts", host]):
        raise RuntimeError(f"tenant {enterprise_id}: DB_HOST is not resolvable in the container network")
    published = run(["podman", "port", host, "5432/tcp"])
    host_port = int(published.rsplit(":", 1)[1])
    password = decrypt_envelope(enterprise_id, snapshot["DB_NAME"], snapshot["DB_PASSWORD"])
    connection = psycopg2.connect(
        host="127.0.0.1", port=host_port, dbname=snapshot["DB_NAME"],
        user=snapshot["DB_USER"], password=password, connect_timeout=5,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user, current_database()")
            if cursor.fetchone() != (snapshot["DB_USER"], snapshot["DB_NAME"]):
                raise RuntimeError(f"tenant {enterprise_id}: authenticated DB identity mismatch")
            cursor.execute(ddl)
            cursor.execute(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema='byai' AND table_name=ANY(%s)", (list(TABLES),)
            )
            if cursor.fetchone()[0] != len(TABLES):
                raise RuntimeError(f"tenant {enterprise_id}: session/message DDL is incomplete")
        connection.commit()
        connection.autocommit = True
        table = f"byai.tenant_node_e2e_probe_{enterprise_id}"
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            try:
                cursor.execute(f"INSERT INTO {table} VALUES (1, 'created')")
                cursor.execute(f"SELECT value FROM {table} WHERE id=1")
                if cursor.fetchone() != ("created",):
                    raise RuntimeError("INSERT/SELECT probe failed")
                cursor.execute(f"UPDATE {table} SET value='updated' WHERE id=1")
                cursor.execute(f"SELECT value FROM {table} WHERE id=1")
                if cursor.fetchone() != ("updated",):
                    raise RuntimeError("UPDATE probe failed")
                cursor.execute(f"DELETE FROM {table} WHERE id=1")
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                if cursor.fetchone()[0] != 0:
                    raise RuntimeError("DELETE probe failed")
            finally:
                cursor.execute(f"DROP TABLE IF EXISTS {table}")
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    print(f"tenant {enterprise_id}: BE record + Redis + internal DNS + Node DDL + SQL CRUD passed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("enterprise_ids", nargs="+", type=int)
    parser.add_argument("--env", type=Path, required=True, help="203 environment file; credentials are never printed")
    args = parser.parse_args()
    values = load_env(args.env)
    sandbox_container = f"byclaw-opensandbox-{values.get('CONTAINER_SUFFIX', 'middleware')}"
    ddl = DDL.read_text()
    platform = psycopg2.connect(
        host=values["DB_HOST"], port=int(values["DB_PORT"]), dbname=values["DB_DATABASE"],
        user=values["DB_USER"], password=values["DB_PASS"], connect_timeout=5,
    )
    cache = redis.Redis(
        host=values["REDIS_HOST"], port=int(values["REDIS_PORT"]),
        username=values.get("REDIS_USERNAME") or None, password=values["REDIS_PASSWORD"],
        db=int(values.get("REDIS_DATABASE", "0")), decode_responses=True,
    )
    try:
        for enterprise_id in args.enterprise_ids:
            verify_tenant(enterprise_id, platform, cache, ddl, sandbox_container)
    finally:
        platform.close()
        cache.close()


if __name__ == "__main__":
    main()
