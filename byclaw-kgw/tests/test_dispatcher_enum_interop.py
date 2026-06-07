"""Sanity check: enum-keyed dispatcher dicts interop transparently with raw strings."""

from kgw.dispatcher import (
    _DEFAULT_KB_PATHS,
    _GATEWAY_TO_KB_OP,
    _READ_OPS,
    _WRITE_HISTORY_OPS,
    GatewayOp,
    KbOp,
)
from kgw.metadata.types import MetadataOperation, MetadataValueType


def test_gateway_to_kb_op_lookup_with_raw_string():
    """HTTP handlers pass operation as str — dict.get must still work."""
    assert _GATEWAY_TO_KB_OP.get("directoryCreate") == KbOp.DIRECTORY_CREATE
    assert _GATEWAY_TO_KB_OP.get("knowledgeSearch") == KbOp.KNOWLEDGE_SEARCH


def test_default_kb_paths_lookup_with_raw_string():
    assert _DEFAULT_KB_PATHS.get("directoryCreate") == "/api/v1/directories/create"
    assert (
        _DEFAULT_KB_PATHS.get("metadataPropertiesBatchCreate")
        == "/api/v1/metadataProperties/batchCreate"
    )


def test_default_kb_paths_lookup_with_enum_member():
    """Internal dispatcher code uses KbOp members."""
    assert _DEFAULT_KB_PATHS.get(KbOp.DIRECTORY_CREATE) == "/api/v1/directories/create"


def test_str_in_read_ops_frozenset():
    """Both raw-str and enum membership tests succeed."""
    assert "knowledgeSearch" in _READ_OPS
    assert GatewayOp.KNOWLEDGE_SEARCH in _READ_OPS


def test_str_in_write_history_ops_frozenset():
    assert "directoryCreate" in _WRITE_HISTORY_OPS
    assert GatewayOp.DIRECTORY_CREATE in _WRITE_HISTORY_OPS


def test_metadata_operation_str_compat():
    assert "set" == MetadataOperation.SET
    assert MetadataOperation.SET == "set"
    assert "set" in {MetadataOperation.SET, MetadataOperation.APPEND}


def test_metadata_value_type_frozenset_str_compat():
    s: frozenset[MetadataValueType] = frozenset(MetadataValueType)
    assert "string" in s
    assert "stringList" in s
    assert "blob" not in s


def test_kb_op_value_used_for_path_fallback():
    """f-string fallback in dispatcher uses .value, not enum repr."""
    assert f"/{KbOp.DIRECTORY_CREATE.value}" == "/directoryCreate"
