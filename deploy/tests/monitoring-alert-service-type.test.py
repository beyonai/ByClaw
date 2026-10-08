#!/usr/bin/env python3
"""Regression check for sandbox alert service type labels."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
K3S = ROOT / "deploy" / "k3s"
ALERT_BLOCK = re.compile(r"(?ms)^          - alert: ([^\n]+)\n(.*?)(?=^          - alert: |\Z)")


class MonitoringAlertServiceTypeTest(unittest.TestCase):
    def check_alerts(self, rule_text: str) -> None:
        alerts = dict(ALERT_BLOCK.findall(rule_text))
        self.assertIn("OpenClawSandboxOOMKilled", alerts)
        self.assertEqual(9, len(alerts))
        for name, body in alerts.items():
            with self.subTest(alert=name):
                self.assertIn("group_left(userCode, profileKey, serviceType)", body)
                self.assertNotRegex(body, r"(?m)^\s+serviceType:\s+openclaw\s*$")

    def test_render_script_rules_keep_runtime_service_type(self) -> None:
        script = (K3S / "render-manifests.sh").read_text()
        start = script.index("  name: prometheus-sandbox-autoscale-rules")
        end = script.index("\nEOF", start)
        self.check_alerts(script[start:end])

    def test_install_script_rules_keep_runtime_service_type(self) -> None:
        script = (K3S / "install-monitoring.sh").read_text()
        start = script.index("  name: prometheus-sandbox-autoscale-rules")
        end = script.index("\nEOF", start)
        self.check_alerts(script[start:end])


if __name__ == "__main__":
    unittest.main()
