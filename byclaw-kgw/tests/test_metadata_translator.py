"""Unit tests for kgw.metadata.translator — pure-function name mapping."""

import copy

from kgw.metadata.translator import (
    translate_request_dsl_where,
    translate_request_metadata,
    translate_response_metadata,
)

N2B = {"status": "__byclaw_kgw__status__v7", "tags": "__byclaw_kgw__tags__v8"}
B2N = {v: k for k, v in N2B.items()}


# ---------------------------------------------------------------------------
# translate_request_metadata — plan tests
# ---------------------------------------------------------------------------


def test_translate_request_metadata_dict_keys():
    payload = {"metadata": {"status": "active", "fileType": "md"}}
    out = translate_request_metadata(payload, N2B)
    assert out["metadata"] == {
        "__byclaw_kgw__status__v7": "active",
        "fileType": "md",
    }


def test_translate_request_metadata_operation_list():
    payload = {
        "operationList": [
            {"propertyName": "status", "operation": "set", "value": "x"},
            {"propertyName": "tags", "operation": "append", "value": ["a"]},
            {"propertyName": "unknown", "operation": "set", "value": "y"},
        ]
    }
    out = translate_request_metadata(payload, N2B)
    names = [op["propertyName"] for op in out["operationList"]]
    assert names == ["__byclaw_kgw__status__v7", "__byclaw_kgw__tags__v8", "unknown"]


def test_translate_request_metadata_field_list():
    payload = {"metadataFieldList": ["status", "tags", "fileType"]}
    out = translate_request_metadata(payload, N2B)
    assert out["metadataFieldList"] == [
        "__byclaw_kgw__status__v7",
        "__byclaw_kgw__tags__v8",
        "fileType",
    ]


# ---------------------------------------------------------------------------
# translate_request_dsl_where — plan tests
# ---------------------------------------------------------------------------


def test_translate_dsl_where_leaf():
    where = {"eq": {"fieldName": "status", "value": "active"}}
    out = translate_request_dsl_where(where, N2B)
    assert out == {"eq": {"fieldName": "__byclaw_kgw__status__v7", "value": "active"}}


def test_translate_dsl_where_nested():
    where = {
        "and": [
            {"eq": {"fieldName": "status", "value": "active"}},
            {
                "or": [
                    {"contains": {"fieldName": "tags", "value": "x"}},
                    {"not": {"exists": {"fieldName": "fileType"}}},
                ]
            },
        ]
    }
    out = translate_request_dsl_where(where, N2B)
    assert out["and"][0]["eq"]["fieldName"] == "__byclaw_kgw__status__v7"
    assert out["and"][1]["or"][0]["contains"]["fieldName"] == "__byclaw_kgw__tags__v8"
    assert out["and"][1]["or"][1]["not"]["exists"]["fieldName"] == "fileType"


# ---------------------------------------------------------------------------
# translate_response_metadata — plan tests
# ---------------------------------------------------------------------------


def test_translate_response_metadata_typed_form():
    payload = {
        "metadata": {
            "__byclaw_kgw__status__v7": {"valueType": "string", "value": "active"},
            "__byclaw_kgw__tags__v8": {"valueType": "stringList", "value": ["a"]},
            "native_field": {"valueType": "string", "value": "z"},
        }
    }
    out = translate_response_metadata(payload, B2N)
    assert "status" in out["metadata"]
    assert "tags" in out["metadata"]
    assert "native_field" in out["metadata"]
    assert "__byclaw_kgw__status__v7" not in out["metadata"]


# ---------------------------------------------------------------------------
# Additional coverage tests
# ---------------------------------------------------------------------------


def test_translate_request_metadata_does_not_mutate_input():
    payload = {
        "metadata": {"status": "active"},
        "operationList": [{"propertyName": "status", "operation": "set", "value": 1}],
        "metadataFieldList": ["status", "tags"],
    }
    original = copy.deepcopy(payload)
    translate_request_metadata(payload, N2B)
    assert payload == original
    assert payload["metadata"] == {"status": "active"}
    assert payload["operationList"][0]["propertyName"] == "status"
    assert payload["metadataFieldList"] == ["status", "tags"]


def test_translate_request_metadata_passthrough_when_keys_absent():
    payload = {"knCode": "hr", "filePath": "/a.md"}
    original = copy.deepcopy(payload)
    out = translate_request_metadata(payload, N2B)
    assert out == original
    # result is a deep copy, not the same object
    assert out is not payload


def test_translate_dsl_where_unknown_op_passthrough():
    where = {"customOp": {"fieldName": "status"}}
    original = copy.deepcopy(where)
    out = translate_request_dsl_where(where, N2B)
    # unknown op returns a deep copy unchanged
    assert out == original
    # verify it really is a deep copy: mutating result must not touch original
    out["customOp"]["fieldName"] = "mutated"
    assert where["customOp"]["fieldName"] == "status"


def test_translate_dsl_where_non_dict_input():
    assert translate_request_dsl_where("string", N2B) == "string"
    result_none = translate_request_dsl_where(None, N2B)
    assert result_none is None
    assert translate_request_dsl_where([1, 2], N2B) == [1, 2]


def test_translate_dsl_where_not_with_nested_leaf():
    where = {"not": {"eq": {"fieldName": "status", "value": "x"}}}
    out = translate_request_dsl_where(where, N2B)
    assert out == {
        "not": {"eq": {"fieldName": "__byclaw_kgw__status__v7", "value": "x"}}
    }


def test_translate_dsl_where_leaf_without_field_name_passthrough():
    where = {"eq": {"value": "x"}}
    out = translate_request_dsl_where(where, N2B)
    assert out == {"eq": {"value": "x"}}


def test_translate_response_metadata_in_search_results():
    payload = {
        "resultObject": {
            "data": [
                {
                    "knCode": "hr",
                    "metadata": {
                        "__byclaw_kgw__status__v7": {"value": "a"},
                    },
                },
                {
                    "knCode": "hr",
                    "metadata": {
                        "__byclaw_kgw__tags__v8": {"value": ["b"]},
                    },
                },
            ]
        }
    }
    out = translate_response_metadata(payload, B2N)
    data = out["resultObject"]["data"]
    assert "status" in data[0]["metadata"]
    assert "__byclaw_kgw__status__v7" not in data[0]["metadata"]
    assert "tags" in data[1]["metadata"]
    assert "__byclaw_kgw__tags__v8" not in data[1]["metadata"]


def test_translate_response_metadata_no_metadata_passthrough():
    payload = {"knCode": "hr", "filePath": "/a.md", "title": "Hello"}
    original = copy.deepcopy(payload)
    out = translate_response_metadata(payload, B2N)
    assert out == original
    assert out is not payload
