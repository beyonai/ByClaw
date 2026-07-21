#!/usr/bin/env python3
"""Regression tests for the related_docs footer writer."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("add_related_docs.py")
yaml_stub = types.ModuleType("yaml")
yaml_stub.safe_load = lambda value: {}
yaml_stub.YAMLError = ValueError
sys.modules.setdefault("yaml", yaml_stub)
SPEC = importlib.util.spec_from_file_location("add_related_docs", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AddRelatedDocsTests(unittest.TestCase):
    def test_writes_a_null_kb_resource_id_for_a_local_relation(self) -> None:
        block = MODULE.build_related_docs_block(
            "/doc.md",
            [{"target_doc_id": "/target.md", "relation": "reference", "kb_resource_id": None}],
        )

        self.assertIn("kb_resource_id: null", block)
        self.assertNotIn('kb_resource_id: "None"', block)

    def test_rejects_a_document_with_an_unclosed_yaml_front_matter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            document = Path(directory) / "bad.md"
            original = "---\ntitle: 示例\n--- related_docs ---\n\ndoc_id: /old\nrelated_docs: []\n--- related_docs ---\n正文"
            document.write_text(original, encoding="utf-8")

            success = MODULE.add_relations_to_doc(
                str(document),
                [{"target_doc_id": "/target.md", "relation": "reference", "kb_resource_id": "1"}],
            )

            self.assertFalse(success)
            self.assertEqual(document.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
