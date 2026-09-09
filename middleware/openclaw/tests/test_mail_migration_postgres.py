import os
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DML = REPOSITORY_ROOT / 'deploy' / 'migrations' / 'versions' / 'V0.4.0' / 'V0.4.0__dml.sql'
DSN = os.environ.get('MAIL_MIGRATION_TEST_DSN')
SQL_RUNNER = os.environ.get('MAIL_MIGRATION_TEST_SQL_RUNNER')
FILE_RUNNER = os.environ.get('MAIL_MIGRATION_TEST_FILE_RUNNER')
DB_CLIENT = os.environ.get('MAIL_MIGRATION_TEST_CLIENT') or shutil.which('gsql') or shutil.which('psql')
REQUIRED = os.environ.get('MAIL_MIGRATION_TEST_REQUIRED') == '1'
PSYCOPG_DSN = os.environ.get('MAIL_MIGRATION_TEST_PSYCOPG_DSN')


def mail_block():
    contents = DML.read_text(encoding='utf-8')
    match = re.search(r'-- Mail 内置 Skill 注册开始\n(.*?)-- Mail 内置 Skill 注册结束', contents, re.DOTALL)
    if not match:
        raise AssertionError('mail migration block is missing')
    return match.group(1)


class MailMigrationOpenGaussTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        available = bool(SQL_RUNNER and FILE_RUNNER) or bool(DB_CLIENT and DSN)
        if available:
            return
        reason = ('set both MAIL_MIGRATION_TEST_SQL_RUNNER and MAIL_MIGRATION_TEST_FILE_RUNNER, '
                  'or provide MAIL_MIGRATION_TEST_DSN with a discoverable gsql/psql client')
        if REQUIRED:
            raise AssertionError(f'OpenGauss migration integration is required: {reason}')
        raise unittest.SkipTest(f'OpenGauss migration integration unavailable locally: {reason}')

    def run_sql(self, sql, *, check=True):
        command = ([SQL_RUNNER, sql] if SQL_RUNNER else
                   [DB_CLIENT, DSN, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', sql])
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if check and result.returncode:
            self.fail(result.stdout + result.stderr)
        return result

    def run_mail_file(self, *, check=True):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', encoding='utf-8', delete=False) as migration:
            migration.write(mail_block())
            migration_path = migration.name
        try:
            command = ([FILE_RUNNER, migration_path] if FILE_RUNNER else
                       [DB_CLIENT, DSN, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-f', migration_path])
            result = subprocess.run(command, check=False, capture_output=True, text=True)
        finally:
            Path(migration_path).unlink(missing_ok=True)
        if check and result.returncode:
            self.fail(result.stdout + result.stderr)
        return result

    def setUp(self):
        self.run_sql(
            'DROP SCHEMA IF EXISTS byai CASCADE; CREATE SCHEMA byai; '
            'CREATE SEQUENCE byai.seq_any_table START 1000; '
            'CREATE TABLE byai.byai_system_config (param_code text, param_value text); '
            'CREATE TABLE byai.ss_resource ('
            'resource_id bigint, system_code text, resource_biz_type text, resource_type text, '
            'resource_name text, resource_desc text, resource_version_id text, host_type text, '
            'catalog_id bigint, man_org_id bigint, man_user_id text, create_by bigint, create_time timestamp, '
            'update_by bigint, update_time timestamp, com_acct_id bigint, resource_status integer, '
            'resource_d_verid bigint, resource_r_verid bigint, resource_code text, publish_time timestamp, '
            'auth_status text, publish_portal smallint, parent_resource_id bigint, publish_type text, '
            'owner_type text, impl_type text, worker_agent_type text); '
            'CREATE TABLE byai.ss_res_ext_skill ('
            'resource_id bigint PRIMARY KEY, skill_type text, source_type text, version text, skill_url text, '
            'skill_package_format text, skill_original_filename text, skill_package_size bigint, '
            'skill_package_hash text, target_content text, sync_status text, sync_error text, last_sync_time timestamp); '
            'CREATE TABLE byai.au_privilege_grant ('
            'privilege_grant_id bigint, grant_type text, oper_type text, grant_obj_type text, grant_obj_id bigint, '
            'eff_date timestamp, exp_date timestamp, status_cd text, create_staff bigint, create_date timestamp, '
            'update_staff bigint, update_date timestamp, grant_to_type text, grant_to_obj_id bigint, '
            'grant_to_obj_type text, allow_unsubscribe text); '
            "INSERT INTO byai.ss_resource (resource_id, resource_code) VALUES (10, 'dws'); "
            "INSERT INTO byai.au_privilege_grant VALUES (11, 'AVAILABLE_USE', 'READ', 'SKILL', 10, now(), null, "
            "'A', 1, now(), 1, now(), 'RED', 10001, 'USER', 'Y')"
        )

    def config(self, value):
        literal = 'NULL' if value is None else "'" + value.replace("'", "''") + "'"
        self.run_sql('DELETE FROM byai.byai_system_config; INSERT INTO byai.byai_system_config VALUES '
                     f"('OPENCLAW_BUNDLED_SKILLS', {literal})")

    def query(self, sql):
        return self.run_sql(sql).stdout.strip()

    def test_arrays_append_exactly_once_and_nonarrays_fail_closed(self):
        for value in ('[]', '[ ]', '[\n {"skillCode":"dws","x":1}\n]'):
            with self.subTest(value=value):
                self.config(value)
                self.run_mail_file()
                self.run_mail_file()
                self.assertEqual('1', self.query(
                    "SELECT count(*) FROM jsonb_array_elements((SELECT param_value::jsonb FROM byai.byai_system_config)) e "
                    "WHERE e->>'skillCode'='mail'"))
                if 'dws' in value:
                    self.assertEqual('1', self.query(
                        "SELECT count(*) FROM jsonb_array_elements((SELECT param_value::jsonb FROM byai.byai_system_config)) e "
                        "WHERE e->>'skillCode'='dws' AND e->>'x'='1'"))
        self.config('[{"skillCode":"mail","custom":true}]')
        self.run_mail_file()
        self.assertIn(self.query(
            "SELECT count(*), bool_and((e->>'custom')::boolean) "
            "FROM jsonb_array_elements((SELECT param_value::jsonb FROM byai.byai_system_config)) e "
            "WHERE e->>'skillCode'='mail'"), ('1|t', '1|true'))
        for value in (None, '{}', '"text"'):
            with self.subTest(value=value):
                self.config(value)
                before = self.query("SELECT coalesce(param_value, '<NULL>') FROM byai.byai_system_config")
                self.run_mail_file()
                self.assertEqual(before, self.query(
                    "SELECT coalesce(param_value, '<NULL>') FROM byai.byai_system_config"))
        self.config('{malformed')
        self.assertNotEqual(0, self.run_mail_file(check=False).returncode)
        self.assertEqual('{malformed|0', self.query(
            "SELECT param_value, (SELECT count(*) FROM byai.ss_resource WHERE resource_code='mail') "
            "FROM byai.byai_system_config"))

    def test_double_replay_converges_stale_duplicates_extensions_and_grants(self):
        self.config('[]')
        self.run_sql(
            "INSERT INTO byai.ss_resource (resource_id, resource_code, resource_name, resource_status) VALUES "
            "(100, 'mail', 'stale', 0), (101, 'mail', 'duplicate', 1); "
            "INSERT INTO byai.ss_res_ext_skill (resource_id, skill_type, source_type, version, sync_status) VALUES "
            "(100, 'hub', 'CHAT_UPLOAD', 'old', 'FAILED'), (101, 'hub', 'CHAT_UPLOAD', 'old2', 'FAILED'); "
            "INSERT INTO byai.au_privilege_grant VALUES "
            "(200, 'AVAILABLE_USE', 'OLD', 'SKILL', 100, now(), null, 'D', 1, now(), 1, now(), 'RED', 10001, 'USER', 'N'),"
            "(201, 'AVAILABLE_USE', 'OLD', 'SKILL', 101, now(), null, 'D', 1, now(), 1, now(), 'RED', 10001, 'USER', 'N')"
        )
        self.run_mail_file()
        self.run_mail_file()
        self.assertEqual('1|Mail|2|passed|enterprise', self.query(
            "SELECT count(*), min(resource_name), min(resource_status), min(auth_status), min(owner_type) "
            "FROM byai.ss_resource WHERE resource_code='mail'"))
        self.assertEqual('1|inner|SYSTEM_BUILTIN|1.0.0|SUCCESS', self.query(
            "SELECT count(*), min(skill_type), min(source_type), min(version), min(sync_status) "
            "FROM byai.ss_res_ext_skill e JOIN byai.ss_resource r USING(resource_id) WHERE r.resource_code='mail'"))
        self.assertEqual('1|READ|A|Y', self.query(
            "SELECT count(*), min(oper_type), min(status_cd), min(allow_unsubscribe) "
            "FROM byai.au_privilege_grant g JOIN byai.ss_resource r ON r.resource_id=g.grant_obj_id "
            "WHERE r.resource_code='mail' AND grant_type='AVAILABLE_USE' AND grant_to_obj_id=10001"))

    def test_null_bearing_grant_converges_with_stale_target_on_double_replay(self):
        self.config('[]')
        self.run_sql(
            "INSERT INTO byai.au_privilege_grant VALUES "
            "(12, 'NULL_SCOPE', 'READ', 'SKILL', 10, now(), null, 'A', 1, now(), 1, now(), "
            "NULL, NULL, NULL, 'Y'); "
            "INSERT INTO byai.ss_resource (resource_id, resource_code) VALUES (100, 'mail'); "
            "INSERT INTO byai.au_privilege_grant VALUES "
            "(202, 'NULL_SCOPE', 'OLD', 'SKILL', 100, now(), null, 'D', 1, now(), 1, now(), "
            "NULL, NULL, NULL, 'N')"
        )
        self.run_mail_file()
        self.run_mail_file()
        self.assertEqual('1|READ|A|Y', self.query(
            "SELECT count(*), min(oper_type), min(status_cd), min(allow_unsubscribe) "
            "FROM byai.au_privilege_grant g JOIN byai.ss_resource r ON r.resource_id=g.grant_obj_id "
            "WHERE r.resource_code='mail' AND grant_type='NULL_SCOPE' "
            "AND grant_to_type IS NULL AND grant_to_obj_id IS NULL AND grant_to_obj_type IS NULL"))

    def test_concurrent_file_replay_creates_one_resource_extension_and_grants(self):
        self.config('[]')
        results = []
        barrier = threading.Barrier(2)

        def run():
            barrier.wait()
            results.append(self.run_mail_file(check=False))

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertTrue(all(result.returncode == 0 for result in results), [result.stderr for result in results])
        self.assertEqual('1|1|2', self.query(
            "SELECT (SELECT count(*) FROM byai.ss_resource WHERE resource_code='mail'), "
            "(SELECT count(*) FROM byai.ss_res_ext_skill e JOIN byai.ss_resource r USING(resource_id) "
            "WHERE r.resource_code='mail'), "
            "(SELECT count(*) FROM byai.au_privilege_grant g JOIN byai.ss_resource r ON r.resource_id=g.grant_obj_id "
            "WHERE r.resource_code='mail')"))

    def test_psycopg_outer_transaction_can_roll_back_the_exact_statement(self):
        if not PSYCOPG_DSN:
            if REQUIRED:
                self.fail('MAIL_MIGRATION_TEST_PSYCOPG_DSN is required in CI')
            self.skipTest('MAIL_MIGRATION_TEST_PSYCOPG_DSN is not configured locally')
        try:
            import psycopg2
        except ImportError:
            if REQUIRED:
                self.fail('psycopg2 is required in CI')
            self.skipTest('psycopg2 is not installed locally')

        self.config('[]')
        connection = psycopg2.connect(PSYCOPG_DSN)
        connection.autocommit = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(mail_block())
                cursor.execute("SELECT count(*) FROM byai.ss_resource WHERE resource_code='mail'")
                self.assertEqual(1, cursor.fetchone()[0])
            connection.rollback()
        finally:
            connection.close()
        self.assertEqual('0|[]', self.query(
            "SELECT (SELECT count(*) FROM byai.ss_resource WHERE resource_code='mail'), "
            "(SELECT param_value FROM byai.byai_system_config "
            "WHERE param_code='OPENCLAW_BUNDLED_SKILLS')"))


if __name__ == '__main__':
    unittest.main()
