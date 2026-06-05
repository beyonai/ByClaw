"""Static Agent DSL syntax reference — returned verbatim by POST /dslGuide."""

from __future__ import annotations

DSL_GUIDE_CONTENT = (
    "## Agent DSL Syntax Reference\n\n"
    "The `where` parameter accepts a JSON AST (Abstract Syntax Tree) for structured filtering. "
    "Each node is an object with exactly one operator key.\n\n"
    "### Boolean Operators\n"
    "- `and`: value must be a non-empty array of sub-expressions\n"
    "- `or`: value must be a non-empty array of sub-expressions\n"
    "- `not`: value must be a single sub-expression object (not an array)\n\n"
    "### Leaf Operators by Field Type\n\n"
    "**string fields** (e.g. status, fileName):\n"
    "Supported: eq, ne, in, exists, prefix, wildcard\n"
    "NOT supported: contains, gt, gte, lt, lte\n\n"
    "**stringList fields** (e.g. tags):\n"
    "Supported: contains, exists\n"
    "NOT supported: eq, ne, in, gt, gte, lt, lte, prefix, wildcard\n\n"
    "**number fields** (e.g. priority):\n"
    "Supported: eq, ne, in, exists, gt, gte, lt, lte\n"
    "NOT supported: contains, prefix, wildcard\n\n"
    "**boolean fields** (e.g. archived):\n"
    "Supported: eq, ne, in, exists\n"
    "NOT supported: contains, gt, gte, lt, lte, prefix, wildcard\n\n"
    "**datetime fields** (e.g. publishedAt):\n"
    "Supported: eq, ne, in, exists, gt, gte, lt, lte\n"
    "NOT supported: contains, prefix, wildcard\n\n"
    "### Value Type Rules\n"
    "- string field: value must be a string\n"
    "- number field: value must be a number (not boolean)\n"
    "- boolean field: value must be a boolean (true/false)\n"
    "- datetime field: value must be an ISO 8601 string, e.g. '2026-05-15T10:00:00Z'\n"
    "- stringList field: only 'contains' (value is a single string) and 'exists' are supported\n"
    "- exists: should not carry a 'value' key\n"
    "- in: value must be a non-empty array; not applicable to stringList (use 'contains' instead)\n"
    "- prefix: string type only; matches values starting with the given prefix\n"
    "- wildcard: string type only; '*' matches zero or more characters, '?' matches exactly one character\n"
    "- gt/gte/lt/lte: number and datetime types only\n\n"
    "### Limits\n"
    "- Maximum boolean nesting depth: 3\n"
    "- Maximum leaf conditions: 12\n\n"
    "### Examples\n\n"
    "1. Simple equality:\n"
    '  {"where": {"eq": {"fieldName": "status", "value": "active"}}}\n\n'
    "2. Boolean combination (AND):\n"
    '  {"where": {"and": [\n'
    '    {"eq": {"fieldName": "status", "value": "active"}},\n'
    '    {"contains": {"fieldName": "tags", "value": "contract"}}\n'
    "  ]}}\n\n"
    "3. Nested boolean with range:\n"
    '  {"where": {"and": [\n'
    '    {"or": [\n'
    '      {"eq": {"fieldName": "status", "value": "active"}},\n'
    '      {"eq": {"fieldName": "status", "value": "pending"}}\n'
    "    ]},\n"
    '    {"gte": {"fieldName": "publishedAt", "value": "2026-01-01T00:00:00Z"}}\n'
    "  ]}}\n\n"
    "### Error Response Format\n"
    "On DSL validation failure, the API returns:\n"
    '  {"errorCode": "DSL_VALIDATION_ERROR", "errorList": [\n'
    '    {"path": "where.and[1].contains.fieldName",\n'
    '     "code": "UNKNOWN_FIELD",\n'
    '     "message": "fieldName \'tagz\' is not defined"}\n'
    "  ]}\n"
)

__all__ = ["DSL_GUIDE_CONTENT"]
