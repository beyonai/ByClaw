from __future__ import annotations

import os
import sys
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(PROJECT_DIR, "src"))

from dbcli.contracts import Policy  # noqa: E402
from dbcli.errors import DbCliError  # noqa: E402
from dbcli.policy import validate_sql  # noqa: E402


MERGE_SQL = """
MERGE INTO byai.customer AS target
USING byai.customer_stage AS source
ON target.customer_id = source.customer_id
WHEN MATCHED THEN
  UPDATE SET customer_name = source.customer_name
WHEN NOT MATCHED THEN
  INSERT (customer_id, customer_name)
  VALUES (source.customer_id, source.customer_name)
"""


class MergePolicyTests(unittest.TestCase):
    def policy(self, *tables: str) -> Policy:
        return Policy(
            writes_require_transaction=True,
            allowed_schemas=("byai",),
            allowed_tables=tuple(tables),
            allowed_operations=("SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"),
        )

    def test_merge_is_allowed_inside_transaction_when_both_tables_are_authorized(self):
        policy = self.policy("byai.customer", "byai.customer_stage")
        self.assertEqual("MERGE", validate_sql(policy, MERGE_SQL, in_transaction=True))

    def test_merge_requires_transaction(self):
        policy = self.policy("byai.customer", "byai.customer_stage")
        with self.assertRaises(DbCliError) as captured:
            validate_sql(policy, MERGE_SQL, in_transaction=False)
        self.assertEqual("WRITE_TRANSACTION_REQUIRED", captured.exception.code)

    def test_merge_rejects_unauthorized_using_table(self):
        policy = self.policy("byai.customer")
        with self.assertRaises(DbCliError) as captured:
            validate_sql(policy, MERGE_SQL, in_transaction=True)
        self.assertEqual("DB_POLICY_DENIED", captured.exception.code)

    def test_merge_rejects_table_in_unauthorized_schema_without_table_allowlist(self):
        policy = self.policy()
        sql = MERGE_SQL.replace("byai.customer_stage", "secret.customer_stage")
        with self.assertRaises(DbCliError) as captured:
            validate_sql(policy, sql, in_transaction=True)
        self.assertEqual("DB_POLICY_DENIED", captured.exception.code)


if __name__ == "__main__":
    unittest.main()
