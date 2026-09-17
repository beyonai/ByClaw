from __future__ import annotations

from typing import Any

from callcli.contracts import CATALOG_TYPES, SUPPORTED_TYPES
from callcli.errors import CallCliError, EXIT_RESOURCE, invalid_argument


PATH = "/byaiService/auth/privilegeGrant/listResourceUseAuth"


def _normalize_item(raw: dict) -> dict:
    route_type = str(raw.get("resourceBizType") or "").upper()
    return {
        "resourceId": str(raw.get("resourceId") or ""),
        "routeType": route_type,
        "resourceBizType": route_type,
        "resourceType": str(raw.get("resourceType") or ""),
        "resourceCode": str(raw.get("resourceCode") or ""),
        "resourceName": str(raw.get("resourceName") or ""),
        "resourceDesc": str(raw.get("resourceDesc") or ""),
        "resourceVersion": str(raw.get("resourceVersionId") or raw.get("version") or ""),
        "systemCode": str(raw.get("systemCode") or ""),
        "hostType": str(raw.get("hostType") or ""),
        "ownerType": str(raw.get("ownerType") or ""),
        "authStatus": str(raw.get("authStatus") or ""),
        "hasPermission": raw.get("hasPermission"),
    }


class ResourceCatalog:
    def __init__(self, client: Any) -> None:
        self.client = client

    async def list_resources(self, *, session_id: str, keyword: str = "",
                             resource_type: str | None = None, page_num: int = 1,
                             page_size: int = 30, all_pages: bool = False) -> dict:
        if not session_id:
            raise invalid_argument("session_id is required")
        normalized = resource_type.upper() if resource_type else None
        if normalized and normalized not in CATALOG_TYPES:
            raise invalid_argument("resource_type must be MCP, TOOLKIT, or AGENT for resource list")
        if page_num <= 0 or page_size <= 0:
            raise invalid_argument("page_num and page_size must be positive")
        page = page_num
        items: list[dict] = []
        total = total_pages = 0
        backend_message = ""
        while True:
            payload = {
                "keyword": keyword, "pageNum": page, "pageSize": page_size,
                "resourceStatus": "2",
                "resourceBizTypeList": [normalized] if normalized else list(CATALOG_TYPES),
                "permission": "", "digitalEmployeeType": "", "language": "zh-CN",
            }
            body = await self.client.json("POST", PATH, session_id=session_id, payload=payload)
            data = body.get("data") if isinstance(body.get("data"), dict) else {}
            raws = data.get("list") if isinstance(data.get("list"), list) else []
            for raw in raws:
                if not isinstance(raw, dict) or str(raw.get("authStatus") or "") != "passed":
                    continue
                item = _normalize_item(raw)
                if item["routeType"] in CATALOG_TYPES or item["routeType"] == "TOOL":
                    items.append(item)
            total = int(data.get("total") or len(items))
            total_pages = int(data.get("totalPages") or 1)
            backend_message = str(body.get("msg") or "")
            if not all_pages or page >= total_pages:
                break
            page += 1
        return {"items": items, "pageNum": page_num, "pageSize": page_size,
                "total": total, "totalPages": total_pages,
                "backendCode": 0, "backendMessage": backend_message}

    async def find_authorized(self, session_id: str, resource_id: str,
                              resource_type: str) -> dict:
        expected = resource_type.upper()
        if expected not in SUPPORTED_TYPES:
            raise CallCliError("UNSUPPORTED_RESOURCE_TYPE", f"unsupported resource type: {expected}",
                               exit_code=EXIT_RESOURCE)
        # TOOL is a compatibility capability; the resource-center TOOL tab maps to all top-level tool types.
        page = await self.list_resources(session_id=session_id, page_size=100, all_pages=True)
        same_id = [item for item in page["items"] if item["resourceId"] == str(resource_id)]
        if not same_id:
            raise CallCliError("RESOURCE_NOT_FOUND", f"authorized resource not found: {resource_id}",
                               exit_code=EXIT_RESOURCE)
        exact = next((item for item in same_id if item["routeType"] == expected), None)
        if exact:
            return exact
        raise CallCliError("RESOURCE_TYPE_MISMATCH",
                           f"resource type mismatch: expected {expected}, actual {same_id[0]['routeType']}",
                           exit_code=EXIT_RESOURCE,
                           details={"expected": expected, "actual": same_id[0]["routeType"]})

