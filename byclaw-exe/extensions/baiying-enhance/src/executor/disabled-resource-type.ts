/**
 * Single source of truth for the four retired Baiying resource business types
 * (`OBJECT` / `VIEW` / `ONTOLOGY_BASE` / `SCENE`), shared by the conversation
 * execution path (`baiying_call` -> capability resolution -> executor dispatch)
 * and the context-injection path (`associatedResources` -> managed prompt files
 * -> sub-agent routing -> executor `selected_resource`).
 *
 * Semantics intentionally mirror the Java side of GitHub #267: the decision is
 * made on the **resource business type field value only** (never on names,
 * descriptions or `targetContent`), case/whitespace normalized, and unknown or
 * forged types stay non-disabled so existing response semantics are preserved.
 *
 * This module is deliberately dependency-free: it imports only
 * `./resource-type.js` (which imports `./types.js`, a type-only re-export with
 * no runtime dependency), so it can be unit-tested without mocking the host
 * (`openclaw`) or Redis.
 */

import { normalizeResourceType } from "./resource-type.js";

/** Canonical disabled resource business types (immutable, exactly four). */
export const DISABLED_RESOURCE_BIZ_TYPES: readonly string[] = ["OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE"];

/**
 * Normalized labels produced by {@link normalizeResourceType} for the four
 * disabled types: `object` / `view` / `ontology_base` / `scene`.
 */
const DISABLED_RESOURCE_TYPE_LABELS: ReadonlySet<string> = new Set(
  DISABLED_RESOURCE_BIZ_TYPES.map((type) => normalizeResourceType(type)),
);

/**
 * Historical alias extension slot. Verified empty on the `D0.5.0` baseline
 * (see the card's `design-document` A3.1): the plugin has no type-level
 * `ONTOLOGY`/`SCENE`/`ONTOLOGY_BASE` literal outside this list. Kept as an
 * explicit, asserted-empty extension point so a future verified alias only has
 * to be added here.
 */
export const DISABLED_RESOURCE_TYPE_ALIASES: readonly string[] = [];

/** Stable disabled error code (same name and meaning as the Java side's `reason`). */
export const RESOURCE_TYPE_DISABLED = "RESOURCE_TYPE_DISABLED";

/** Explicit `resource_id` is not associated with the current agent. */
export const RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";

/** User-visible message for a disabled resource type. */
export const DISABLED_RESOURCE_MESSAGE = "该资源类型的能力已下线，不支持查询或调用";

/**
 * Unified guidance for managed prompt files and the `baiying_call` tool
 * description. Deliberately free of internal implementation details
 * (`call_object_ids` / `call_view_ids` / `BYCLAW_DATA` / `callAgent` /
 * `file_url` / Redis snapshot wording).
 */
export const DISABLED_RESOURCE_GUIDANCE =
  "对象（OBJECT）、视图（VIEW）、本体库（ONTOLOGY_BASE）、场景（SCENE）四类资源的能力已下线：" +
  "`baiying_call` 不再查询、不再调用它们，也不会返回它们的任何内容；" +
  "请改用知识库、工具、工具集、MCP 或智能体资源。";

/**
 * Whether a **resource business type field value** refers to a disabled type.
 *
 * Accepts any casing, surrounding whitespace and the lowercase labels produced
 * by `normalizeResourceType` (`object` / `view`). Non-string inputs (including a
 * whole JSON Schema fragment) and empty values are not disabled — the caller is
 * responsible for only passing resource-type field values.
 */
export function isDisabledResourceBizType(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const label = normalizeResourceType(value);
  if (!label) {
    return false;
  }
  return DISABLED_RESOURCE_TYPE_LABELS.has(label) || DISABLED_RESOURCE_TYPE_ALIASES.includes(label);
}

/**
 * Whether an associated-resource record (`resourceBizType` / `resourceType`)
 * refers to a disabled type.
 */
export function isDisabledRelResource(
  raw: { resourceBizType?: unknown; resourceType?: unknown } | null | undefined,
): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  return isDisabledResourceBizType(raw.resourceBizType) || isDisabledResourceBizType(raw.resourceType);
}
