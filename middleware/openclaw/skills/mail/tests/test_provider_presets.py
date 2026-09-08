from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
REPO = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(SCRIPTS))

from _support import account
from mail_runtime.imap_smtp import ImapSmtpAdapter
from mail_runtime.models import AccountConfig
from mail_runtime.providers import capability_descriptor, setup_requirements
from mail_runtime.registry import build_default_registry
from mailctl import supports_operation


class ProviderPresetContractTest(unittest.TestCase):
    def test_backend_catalog_is_the_single_endpoint_source_for_projected_presets(self):
        catalog = (REPO / "byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/mail/MailProviderCatalog.java").read_text()
        expected = {
            "qq": ("imap.qq.com", "smtp.qq.com"),
            "netease-163": ("imap.163.com", "smtp.163.com"),
            "aliyun-mail": ("imap.qiye.aliyun.com", "smtp.qiye.aliyun.com"),
        }
        for provider, (imap_host, smtp_host) in expected.items():
            pattern = rf'provider\("{re.escape(provider)}".*?"APP_PASSWORD".*?server\("{re.escape(imap_host)}", 993\).*?server\("{re.escape(smtp_host)}", 465\)'
            self.assertRegex(catalog.replace("\n", " "), pattern)

            value = account(provider=provider)
            value["server"] = {
                "imap": {"host": imap_host, "port": 993, "encryption": "SSL"},
                "smtp": {"host": smtp_host, "port": 465, "encryption": "SSL"},
            }
            adapter = build_default_registry().adapter_for(AccountConfig.from_mapping(value))
            self.assertIsInstance(adapter, ImapSmtpAdapter)

    def test_capability_matrix_does_not_overpromise_imap_delete(self):
        for provider in ("gmail", "microsoft-365", "fastmail"):
            value = account(provider=provider)
            value["capabilityStatus"] = {name: "YES" for name in value["capabilities"]}
            descriptor = capability_descriptor(AccountConfig.from_mapping(value))
            self.assertTrue(all(value == "YES" for value in descriptor.values()))
        for provider in ("qq", "netease-163", "aliyun-mail"):
            value = account(provider=provider)
            value["capabilities"].remove("delete")
            value["capabilityStatus"] = {**{name: "YES" for name in value["capabilities"]}, "delete": "CONDITIONAL_MOVE_OR_UIDPLUS"}
            descriptor = capability_descriptor(AccountConfig.from_mapping(value))
            self.assertTrue(all(descriptor[name] == "YES" for name in ("list", "get", "search", "downloadAttachment", "send", "reply")))
            self.assertEqual("CONDITIONAL_MOVE_OR_UIDPLUS", descriptor["delete"])
            summary = AccountConfig.from_mapping(value).public_summary().to_dict()
            self.assertEqual("CONDITIONAL_MOVE_OR_UIDPLUS", summary["capabilityStatus"]["delete"])
            self.assertNotIn("auth", summary)
            self.assertTrue(supports_operation(AccountConfig.from_mapping(value), "delete"))

    def test_setup_requirements_are_safe_and_provider_specific(self):
        codes = {
            "qq": ["ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE"],
            "netease-163": ["ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE"],
            "aliyun-mail": ["ADMIN_ENABLE_THIRD_PARTY_CLIENT", "USE_SECURITY_PASSWORD"],
        }
        for provider, expected in codes.items():
            value = account(provider=provider)
            value["setupRequirements"] = expected
            self.assertEqual(tuple(expected), setup_requirements(AccountConfig.from_mapping(value)))


if __name__ == "__main__":
    unittest.main()
