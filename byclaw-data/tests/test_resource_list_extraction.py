"""resource_list 工具白名单提取的纯函数级单元测试。

覆盖《优化方案》7.1 节中无需启动 worker 即可校验的用例：
UC-W7 ~ UC-W11、UC-W14。
"""

from __future__ import annotations

from typing import Any

import pytest
from byclaw_data.worker import _extract_tool_resource_codes


class TestExtractToolResourceCodes:
    """_extract_tool_resource_codes 纯函数行为。"""

    def test_empty_list_returns_empty_tuples(self) -> None:
        assert _extract_tool_resource_codes([]) == ([], [])

    def test_single_object(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project", "resourceId": "1"}
        ]
        assert _extract_tool_resource_codes(rl) == (["by_project"], [])

    def test_object_and_view(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
            {"resourceType": "VIEW", "resouceCode": "by_sale_view"},
        ]
        assert _extract_tool_resource_codes(rl) == (
            ["by_project"],
            ["by_sale_view"],
        )

    def test_dig_employee_ignored(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
            {"resourceType": "DIG_EMPLOYEE", "resouceCode": "DIG_EMPLOYEE"},
        ]
        assert _extract_tool_resource_codes(rl) == (["by_project"], [])

    def test_kg_doc_file_ignored(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
            {"resourceType": "KG_DOC_FILE", "resourceId": "/path"},
        ]
        assert _extract_tool_resource_codes(rl) == (["by_project"], [])

    @pytest.mark.parametrize(
        ("rtype_obj", "rtype_view"),
        [("object", "view"), ("Object", "View"), ("OBJECT", "VIEW")],
    )
    def test_case_insensitive(self, rtype_obj: str, rtype_view: str) -> None:
        rl: list[Any] = [
            {"resourceType": rtype_obj, "resouceCode": "o"},
            {"resourceType": rtype_view, "resouceCode": "v"},
        ]
        assert _extract_tool_resource_codes(rl) == (["o"], ["v"])

    def test_resouce_code_takes_precedence_over_resource_code(self) -> None:
        rl: list[Any] = [
            {
                "resourceType": "OBJECT",
                "resouceCode": "good",
                "resourceCode": "bad",
            }
        ]
        assert _extract_tool_resource_codes(rl) == (["good"], [])

    def test_falls_back_to_resource_code_when_resouce_code_missing(self) -> None:
        rl: list[Any] = [{"resourceType": "OBJECT", "resourceCode": "fallback"}]
        assert _extract_tool_resource_codes(rl) == (["fallback"], [])

    def test_duplicate_object_deduped(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
        ]
        assert _extract_tool_resource_codes(rl) == (["by_project"], [])

    def test_missing_resource_code_skipped(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": ""},
            {"resourceType": "OBJECT"},
            {"resourceType": "OBJECT", "resouceCode": "ok"},
        ]
        assert _extract_tool_resource_codes(rl) == (["ok"], [])

    def test_same_code_in_object_and_view(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "x"},
            {"resourceType": "VIEW", "resouceCode": "x"},
        ]
        assert _extract_tool_resource_codes(rl) == (["x"], ["x"])

    def test_non_dict_items_skipped(self) -> None:
        rl: list[Any] = [
            "not-a-dict",
            None,
            123,
            {"resourceType": "OBJECT", "resouceCode": "ok"},
        ]
        assert _extract_tool_resource_codes(rl) == (["ok"], [])

    def test_whitespace_resource_code_stripped_and_skipped_when_empty(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "   "},
            {"resourceType": "OBJECT", "resouceCode": "  by_project  "},
        ]
        assert _extract_tool_resource_codes(rl) == (["by_project"], [])

    def test_preserve_first_occurrence_order(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "b"},
            {"resourceType": "OBJECT", "resouceCode": "a"},
            {"resourceType": "OBJECT", "resouceCode": "c"},
        ]
        assert _extract_tool_resource_codes(rl) == (["b", "a", "c"], [])

    def test_non_string_resource_type_skipped(self) -> None:
        rl: list[Any] = [
            {"resourceType": None, "resouceCode": "x"},
            {"resourceType": 123, "resouceCode": "y"},
            {"resourceType": "OBJECT", "resouceCode": "ok"},
        ]
        assert _extract_tool_resource_codes(rl) == (["ok"], [])
