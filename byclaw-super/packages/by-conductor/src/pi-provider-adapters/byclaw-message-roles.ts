type JsonRecord = Record<string, unknown>;

/**
 * Enforce byclaw-super's provider-facing message-role contract.
 *
 * Pi may emit `developer` for reasoning-enabled OpenAI Responses models.
 * byclaw-super does not expose that role, so normalize it at the final
 * provider request boundary for both Responses (`input`) and Chat
 * Completions (`messages`) payloads.
 */
export function adaptByclawMessageRoles(payload: unknown): unknown {
  if (!isJsonRecord(payload)) {
    return payload;
  }

  let changed = false;
  const adapted: JsonRecord = { ...payload };
  for (const key of ["input", "messages"] as const) {
    const items = payload[key];
    if (!Array.isArray(items)) {
      continue;
    }
    let keyChanged = false;
    const normalized = items.map((item) => {
      if (!isJsonRecord(item) || item.role !== "developer") {
        return item;
      }
      changed = true;
      keyChanged = true;
      return { ...item, role: "system" };
    });
    if (keyChanged) {
      adapted[key] = normalized;
    }
  }

  return changed ? adapted : payload;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
