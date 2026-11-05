#!/usr/bin/env python3
"""Execute the V0.6.0 Lark manifest migration on a disposable PostgreSQL instance.

Set BYCLAW_MIGRATION_PG_BINDIR if initdb, pg_ctl and psql are not on PATH.
The fixture never connects to an existing database or opens a TCP listener.
"""

import copy
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "deploy/migrations/versions/V0.6.0/V0.6.0__dml.sql"
BEGIN = "-- BEGIN LARK APP USER SCOPE COMMANDS"
END = "-- END LARK APP USER SCOPE COMMANDS"
DEFAULT_LOGIN = ["lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json"]


def pg_binary(name):
    bindir = os.environ.get("BYCLAW_MIGRATION_PG_BINDIR")
    return str(Path(bindir) / name) if bindir else shutil.which(name)


class LarkScopeMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binaries = {name: pg_binary(name) for name in ("initdb", "pg_ctl", "psql")}
        if any(not binary or not Path(binary).is_file() for binary in cls.binaries.values()):
            raise unittest.SkipTest("PostgreSQL binaries required; set BYCLAW_MIGRATION_PG_BINDIR")
        cls.temp = tempfile.TemporaryDirectory(prefix="lark-migration-", dir="/tmp")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.socket_dir = cls.temp.name
        cls.data_dir = str(Path(cls.temp.name) / "data")
        cls.env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        cls.run_process([
            cls.binaries["initdb"], "-D", cls.data_dir, "--username=migration_test",
            "--auth=trust", "--no-locale", "--encoding=UTF8",
        ])
        cls.run_process([
            cls.binaries["pg_ctl"], "-D", cls.data_dir, "-l", str(Path(cls.temp.name) / "postgres.log"),
            "-o", f"-F -k {shlex.quote(cls.socket_dir)} -c listen_addresses='' -p 5432",
            "-w", "start",
        ])
        cls.addClassCleanup(cls.run_process, [
            cls.binaries["pg_ctl"], "-D", cls.data_dir, "-m", "immediate", "-w", "stop",
        ])
        cls.sql("""
            CREATE SCHEMA byai;
            CREATE TABLE byai.byai_connector_info (
                connector_id bigint PRIMARY KEY,
                connector_code text,
                provider_code text,
                runtime_manifest text,
                auth_config text DEFAULT '{"custom":"keep"}',
                update_time timestamp DEFAULT '2026-01-01 00:00:00'
            );
        """)

    @classmethod
    def run_process(cls, command, stdin=None):
        result = subprocess.run(command, input=stdin, text=True, capture_output=True, env=cls.env)
        if result.returncode:
            raise AssertionError(f"{Path(command[0]).name} failed:\n{result.stderr}\n{result.stdout}")
        return result.stdout.strip()

    @classmethod
    def sql(cls, statement):
        return cls.run_process([
            cls.binaries["psql"], "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
            "-h", cls.socket_dir, "-p", "5432", "-U", "migration_test", "-d", "postgres",
        ], statement)

    def setUp(self):
        self.sql("TRUNCATE byai.byai_connector_info")

    def migrate(self):
        source = MIGRATION.read_text()
        self.assertTrue(BEGIN in source, "V0.6.0 must contain the Lark scope command migration")
        self.assertTrue(END in source, "Lark migration must have a bounded executable section")
        self.sql(source.split(BEGIN, 1)[1].split(END, 1)[0])

    @staticmethod
    def manifest():
        return {
            "schemaVersion": "1.0", "id": "lark", "version": "1.0.85",
            "runtime": {
                "type": "cli", "authorizeIn": "user-sandbox", "customRuntime": "keep",
                "commands": {
                    "login": [DEFAULT_LOGIN.copy(), [
                        "lark-cli", "auth", "login", "--device-code", "${deviceCode}", "--json",
                    ]],
                    "status": [["lark-cli", "auth", "status", "--json", "--verify"]],
                    "logout": [["lark-cli", "auth", "logout", "--json"]],
                },
            },
            "authStorage": {"environment": {"LARK_HOME": "/private/custom/lark"}},
            "customExtension": {"nested": [1, 2]},
        }

    def insert(self, manifest, code="lark", provider="lark-cli"):
        value = "NULL" if manifest is None else "'" + json.dumps(manifest).replace("'", "''") + "'"
        self.sql(f"""
            INSERT INTO byai.byai_connector_info
                (connector_id, connector_code, provider_code, runtime_manifest)
            VALUES (3, '{code}', '{provider}', {value});
        """)

    def row(self):
        return json.loads(self.sql("SELECT row_to_json(info) FROM byai.byai_connector_info info"))

    def test_default_manifest_gains_scope_commands_without_changing_existing_content(self):
        before = self.manifest()
        self.insert(before)
        self.migrate()
        row = self.row()
        actual = json.loads(row["runtime_manifest"])
        expected = copy.deepcopy(before)
        expected["runtime"]["commands"].update({
            "scopesCheck": [["lark-cli", "auth", "scopes", "--json"]],
            "loginWithScopes": [[
                "lark-cli", "auth", "login", "--domain", "all", "--scope", "${userScopes}",
                "--no-wait", "--json",
            ]],
        })
        self.assertEqual(expected, actual)
        self.assertEqual('{"custom":"keep"}', row["auth_config"])
        self.assertNotEqual("2026-01-01T00:00:00", row["update_time"])

    def test_replay_changes_neither_manifest_nor_update_time(self):
        self.insert(self.manifest())
        self.migrate()
        after_first = self.row()
        self.migrate()
        self.assertEqual(after_first, self.row())

    def test_existing_scope_commands_are_preserved_when_the_other_is_added(self):
        for action in ("scopesCheck", "loginWithScopes"):
            with self.subTest(action=action):
                self.setUp()
                manifest = self.manifest()
                custom = [["custom-cli", "custom-action", "--keep"]]
                manifest["runtime"]["commands"][action] = custom
                self.insert(manifest)
                self.migrate()
                commands = json.loads(self.row()["runtime_manifest"])["runtime"]["commands"]
                self.assertEqual(custom, commands[action])
                self.assertIn("scopesCheck", commands)
                self.assertIn("loginWithScopes", commands)
                self.assertEqual(manifest["runtime"]["commands"]["login"], commands["login"])

    def test_manifest_with_both_existing_scope_actions_is_not_rewritten(self):
        manifest = self.manifest()
        manifest["runtime"]["commands"].update({"scopesCheck": None, "loginWithScopes": []})
        self.insert(manifest)
        before = self.row()
        self.migrate()
        self.assertEqual(before, self.row())

    def test_custom_login_parameters_are_not_bypassed_by_a_new_default_command(self):
        for login in (
            ["lark-cli", "auth", "login", "--domain", "contact", "--no-wait", "--json"],
            DEFAULT_LOGIN + ["--exclude", "mail:user_mailbox.message:send"],
            DEFAULT_LOGIN + ["--scope", "contact:contact.base:readonly"],
            ["/custom/bin/lark-cli", *DEFAULT_LOGIN[1:]],
        ):
            with self.subTest(login=login):
                self.setUp()
                manifest = self.manifest()
                manifest["runtime"]["commands"]["login"][0] = login
                self.insert(manifest)
                before = self.row()
                self.migrate()
                self.assertEqual(before, self.row())

    def test_unrelated_connectors_or_runtime_types_are_unchanged(self):
        for code, provider, runtime_type in (
            ("wecom", "wecom-cli", "cli"),
            ("lark-custom", "lark-cli", "cli"),
            ("lark", "custom-provider", "cli"),
            ("lark", "lark-cli", "oauth2"),
        ):
            with self.subTest(code=code, provider=provider, runtime_type=runtime_type):
                self.setUp()
                manifest = self.manifest()
                manifest["runtime"]["type"] = runtime_type
                self.insert(manifest, code, provider)
                before = self.row()
                self.migrate()
                self.assertEqual(before, self.row())

    def test_legacy_flat_login_and_missing_runtime_data_are_left_for_compatibility(self):
        flat = self.manifest()
        flat["runtime"]["commands"]["login"] = DEFAULT_LOGIN.copy()
        for manifest in (None, {}, {"runtime": {}}, {"runtime": {"commands": None}}, flat):
            with self.subTest(manifest=manifest):
                self.setUp()
                self.insert(manifest)
                before = self.row()
                self.migrate()
                self.assertEqual(before, self.row())


if __name__ == "__main__":
    unittest.main()
