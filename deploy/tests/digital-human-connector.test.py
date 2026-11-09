"""Validate the digital-human seed against the credential form UI contract."""

import json
from pathlib import Path
import re
import unittest
from urllib.parse import urlparse


class DigitalHumanConnectorTemplateTest(unittest.TestCase):
    def test_insert_and_update_supply_the_same_usable_credential_form(self):
        migration = Path(__file__).resolve().parents[1] / "migrations/versions/V0.6.0/V0.6.0__dml.sql"
        sql = migration.read_text().split("-- 火山数字人连接器：", 1)[1]
        forms = []
        for literal in re.findall(r"'((?:[^']|'')*)'", sql):
            if not literal.startswith('{"credentialForm":'):
                continue
            form = json.loads(literal.replace("''", "'"))["credentialForm"]
            url = urlparse(form["helpUrl"])
            self.assertEqual(url.scheme, "https")
            self.assertTrue(url.hostname)
            self.assertFalse(url.username)
            self.assertTrue(0 < len(form["helpText"]) <= 500)
            self.assertTrue(0 < len(form["helpLinkText"]) <= 100)
            self.assertEqual([field["key"] for field in form["fields"]],
                             ["accessKeyId", "secretAccessKey"])
            self.assertTrue(all(field["inputType"] == "password" for field in form["fields"]))
            forms.append(form)
        self.assertEqual(len(forms), 2, "Both INSERT and UPDATE must provide the form")
        self.assertEqual(forms[0], forms[1])


if __name__ == "__main__":
    unittest.main()
