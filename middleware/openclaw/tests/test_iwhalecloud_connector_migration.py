import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SQL = ROOT / "deploy/migrations/versions/V0.5.0/V0.5.0__dml.sql"


class IwhalecloudAccountTemplateMigrationTest(unittest.TestCase):
    def test_replay_creates_one_web_template_and_preserves_existing_state(self):
        content = SQL.read_text(encoding="utf-8")
        marker = "-- 浩鲸邮箱网页账号模板开始"
        self.assertIn(marker, content)
        statement = content.split(marker, 1)[1].split("-- 浩鲸邮箱网页账号模板结束", 1)[0]
        # Execute the portable INSERT/NOT EXISTS against an isolated local schema.
        # This checks data semantics; it does not replace an OpenGauss release test.
        with sqlite3.connect(":memory:") as db:
            db.execute("ATTACH DATABASE ':memory:' AS byai")
            db.create_function("nextval", 1, lambda _: 100)
            db.execute("""CREATE TABLE byai.byai_connector_info (
                connector_id INTEGER, connector_code TEXT UNIQUE, connector_name TEXT,
                description TEXT, connector_type TEXT, provider_code TEXT, skill_code TEXT,
                auth_mode TEXT, auth_config TEXT, request_config TEXT, runtime_manifest TEXT,
                sort INTEGER, status_cd TEXT)""")
            db.executescript(statement)
            db.executescript(statement)
            rows = db.execute("SELECT * FROM byai.byai_connector_info").fetchall()
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertEqual(row[1:3], ("iwhalecloud-mail-web", "浩鲸邮箱"))
            self.assertEqual(row[4:9], ("ACCOUNT_TEMPLATE", None, None, "NONE", "{}"))
            self.assertEqual(json.loads(row[9]), {"operationAccount": {
                "platformCode": "CustomLink", "accountName": "浩鲸邮箱",
                "accountCode": "", "customUrl": "https://mail.iwhalecloud.com/"}})
            self.assertIsNone(row[10])
            self.assertEqual(row[12], "00A")
            db.execute("UPDATE byai.byai_connector_info SET status_cd='00X', connector_name='自定义名称'")
            db.executescript(statement)
            self.assertEqual(db.execute("SELECT status_cd, connector_name FROM byai.byai_connector_info").fetchone(),
                             ("00X", "自定义名称"))


if __name__ == "__main__":
    unittest.main()
