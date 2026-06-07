from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class InlineBase64Content(BaseModel):
    encoding: Literal["base64"]
    data: str


class RemoteUrlContent(BaseModel):
    url: str
    checksum: str | None = None


class StandardItem(BaseModel):
    source_id: str = Field(alias="sourceId", min_length=1, max_length=128)
    item_id: str = Field(alias="itemId", min_length=1, max_length=256)
    version: str | None = Field(default=None, max_length=128)
    op: Literal["upsert", "delete"]
    kn_code: str = Field(alias="knCode", min_length=1, max_length=64)
    file_path: str = Field(alias="filePath", min_length=1, max_length=512)
    title: str | None = None
    content: str | InlineBase64Content | RemoteUrlContent | None = None
    content_type: str | None = Field(default=None, alias="contentType")
    metadata: dict[str, Any] | None = None
    source_timestamp: str | None = Field(default=None, alias="sourceTimestamp")
    extra: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _validate_op_fields(self) -> StandardItem:
        if self.op == "upsert" and self.content is None:
            raise ValueError("content is required for op='upsert'")
        return self
