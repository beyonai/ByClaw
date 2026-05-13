import type { Dict, ExecutorFailure } from "./types.js";
import { isRecord } from "./types.js";
import { makeError } from "./errors.js";

/** Mirror of `_resolve_child_action`. */
export function resolveChildAction(params: {
  parentResourceId: string;
  parentResourceType: string;
  action: string;
  items: unknown[];
  actionType: string;
}): { item: Dict | null; error: ExecutorFailure | null } {
  const candidates = params.items.filter(
    (item): item is Dict => isRecord(item) && item.name != null,
  );
  if (candidates.length === 0) {
    return {
      item: null,
      error: makeError(
        "ACTION_NOT_FOUND",
        `${params.parentResourceType} resource has no available child actions`,
        {
          target: {
            resource_id: params.parentResourceId,
            resource_type: params.parentResourceType,
            action: params.action,
          },
        },
      ),
    };
  }

  const normalizedAction = (params.action ?? "").trim().toLowerCase();
  if (normalizedAction) {
    for (const item of candidates) {
      const name = String(item.name ?? "").trim();
      if (normalizedAction === name.toLowerCase()) {
        return { item, error: null };
      }
    }
    for (const item of candidates) {
      const name = String(item.name ?? "").trim();
      if (name.toLowerCase().includes(normalizedAction)) {
        return { item, error: null };
      }
    }
    return {
      item: null,
      error: makeError(
        "ACTION_NOT_FOUND",
        `Action \`${params.action}\` not found for resource \`${params.parentResourceId}\``,
        {
          target: {
            resource_id: params.parentResourceId,
            resource_type: params.parentResourceType,
            action: params.action,
          },
          available_actions: candidates.map((item) => item.name),
        },
      ),
    };
  }

  if (candidates.length === 1) {
    return { item: candidates[0], error: null };
  }

  return {
    item: null,
    error: makeError(
      "ACTION_REQUIRED",
      "This resource contains multiple child tools. Please choose one with `action`.",
      {
        target: {
          resource_id: params.parentResourceId,
          resource_type: params.parentResourceType,
        },
        available_actions: candidates.map((item) => item.name),
        action_type: params.actionType,
      },
    ),
  };
}
