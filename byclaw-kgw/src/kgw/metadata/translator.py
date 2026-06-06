"""Pure-function name mapping for metadata properties.

Converts propertyName ↔ backend_name in request/response payloads.
Callers prepare the mapping dicts from the registry and call these
functions; no DB, no HTTP, no side-effects.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# DSL operator categories used by translate_request_dsl_where.
_DSL_BOOL_OPS: frozenset[str] = frozenset({"and", "or", "not"})
_DSL_LEAF_OPS: frozenset[str] = frozenset(
    {
        "eq",
        "ne",
        "in",
        "contains",
        "exists",
        "gt",
        "gte",
        "lt",
        "lte",
        "prefix",
        "wildcard",
    }
)


def translate_request_metadata(
    payload: dict[str, Any],
    name_to_backend: dict[str, str],
) -> dict[str, Any]:
    """Rewrite request payload keys: propertyName → backend_name.

    Returns a deep copy of *payload* with three positions rewritten when
    present:

    * ``payload["metadata"]`` — dict keys mapped via *name_to_backend*;
      unknown keys pass through unchanged.
    * ``payload["operationList"]`` — each item's ``propertyName`` field
      mapped; unknown values pass through.
    * ``payload["metadataFieldList"]`` — each string element mapped;
      unknown strings pass through.

    The original *payload* is never mutated.
    """
    result: dict[str, Any] = deepcopy(payload)

    if isinstance(result.get("metadata"), dict):
        old_meta: dict[str, Any] = result["metadata"]
        result["metadata"] = {name_to_backend.get(k, k): v for k, v in old_meta.items()}

    if isinstance(result.get("operationList"), list):
        for item in result["operationList"]:
            if isinstance(item, dict) and "propertyName" in item:
                item["propertyName"] = name_to_backend.get(
                    item["propertyName"], item["propertyName"]
                )

    if isinstance(result.get("metadataFieldList"), list):
        result["metadataFieldList"] = [
            name_to_backend.get(f, f) if isinstance(f, str) else f
            for f in result["metadataFieldList"]
        ]

    return result


def translate_request_dsl_where(
    where: Any,
    name_to_backend: dict[str, str],
) -> Any:
    """Recursively rewrite ``fieldName`` values in a DSL where-clause AST.

    Bool operators (``and``, ``or``) carry a list of child nodes — each
    child is recursed.  The ``not`` operator carries a single child dict
    — it is recursed directly.  Leaf operators
    (``eq``, ``ne``, ``in``, ``contains``, ``exists``, ``gt``, ``gte``,
    ``lt``, ``lte``, ``prefix``, ``wildcard``) carry a body dict; if
    ``fieldName`` is present its value is mapped via *name_to_backend*
    (unknown values pass through).

    Anything else (non-dict input, dict with ≠ 1 key, unknown op key)
    is returned as a deep copy, unchanged.

    The original *where* is never mutated.
    """
    if not isinstance(where, dict) or len(where) != 1:
        return deepcopy(where)

    (op, body) = next(iter(where.items()))

    if op in _DSL_BOOL_OPS:
        if op == "not":
            return {op: translate_request_dsl_where(body, name_to_backend)}
        # "and" / "or" — body is a list of children
        if isinstance(body, list):
            return {
                op: [
                    translate_request_dsl_where(child, name_to_backend)
                    for child in body
                ]
            }
        return deepcopy(where)

    if op in _DSL_LEAF_OPS:
        if not isinstance(body, dict):
            return deepcopy(where)
        new_body = deepcopy(body)
        if "fieldName" in new_body:
            new_body["fieldName"] = name_to_backend.get(
                new_body["fieldName"], new_body["fieldName"]
            )
        return {op: new_body}

    # unknown op — deep copy unchanged
    return deepcopy(where)


def translate_response_metadata(
    payload: dict[str, Any],
    backend_to_name: dict[str, str],
) -> dict[str, Any]:
    """Rewrite response payload keys: backend_name → propertyName.

    Returns a deep copy of *payload* with every nested ``metadata`` dict
    having its keys remapped via *backend_to_name*.  Recurses into nested
    dicts and lists, covering structures like
    ``resultObject.data[].metadata``.  Only dict keys are rewritten; value
    sub-objects (``{"valueType": ..., "value": ...}``) are preserved as-is.
    Unknown keys pass through.

    The original *payload* is never mutated.
    """
    return _remap_node(deepcopy(payload), backend_to_name)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _remap_node(node: Any, backend_to_name: dict[str, str]) -> Any:
    """Recursively walk *node* (already a deep copy) and rewrite metadata keys."""
    if isinstance(node, dict):
        if "metadata" in node and isinstance(node["metadata"], dict):
            node["metadata"] = {
                backend_to_name.get(k, k): v for k, v in node["metadata"].items()
            }
        # skip recursing into metadata values — keys rewritten above, values are opaque
        for k, v in list(node.items()):
            if k != "metadata":
                node[k] = _remap_node(v, backend_to_name)
        return node
    if isinstance(node, list):
        return [_remap_node(item, backend_to_name) for item in node]
    return node
