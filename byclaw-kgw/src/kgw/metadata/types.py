"""Cross-package enum definitions for the metadata subsystem."""

from __future__ import annotations

import enum


class MetadataOperation(str, enum.Enum):
    """Operations supported by ``/knowledgeItems/metadata/update`` operationList items."""

    SET = "set"
    UNSET = "unset"
    APPEND = "append"
    REMOVE = "remove"
    CLEAR = "clear"


class MetadataValueType(str, enum.Enum):
    """Allowed valueType values for metadataProperty definitions."""

    STRING = "string"
    STRING_LIST = "stringList"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATETIME = "datetime"
