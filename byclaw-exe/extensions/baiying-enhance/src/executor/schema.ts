import type { Dict, ExecutorFailure } from "./types.js";
import { isRecord } from "./types.js";
import { makeError } from "./errors.js";

/** Mirror of `_load_json_schema`. */
export function loadJsonSchema(raw: unknown): Dict | null {
  if (raw === null || raw === undefined || raw === "" || raw === "null") {
    return null;
  }
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || text === "null") return null;
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Mirror of `_schema_type_names`. */
export function schemaTypeNames(schema: Dict | null | undefined): string[] {
  if (!schema) return [];
  const values: string[] = [];
  if (typeof schema.type === "string") {
    values.push(schema.type);
  } else if (Array.isArray(schema.type)) {
    values.push(...schema.type.map((item) => String(item)));
  }
  if (Array.isArray(schema.types)) {
    values.push(...schema.types.map((item) => String(item)));
  }
  return values.filter(Boolean);
}

/** Mirror of `_summarize_schema`. */
export function summarizeSchema(rawSchema: unknown): string | undefined {
  const schema = loadJsonSchema(rawSchema);
  if (!schema) return undefined;

  const properties = schema.properties;
  if (!isRecord(properties)) {
    const typeNames = schemaTypeNames(schema);
    return typeNames[0];
  }

  const required = new Set(
    (Array.isArray(schema.required) ? schema.required : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean),
  );

  const entries: string[] = [];
  let index = 0;
  for (const [name, prop] of Object.entries(properties)) {
    if (index >= 4) {
      entries.push("...");
      break;
    }
    const propSchema = isRecord(prop) ? prop : {};
    const typeNames = schemaTypeNames(propSchema);
    const typeLabel = typeNames[0] || "any";
    const marker = required.has(name) ? "*" : "";
    entries.push(`${name}${marker}:${typeLabel}`);
    index += 1;
  }
  return entries.length ? entries.join(", ") : undefined;
}

/** Mirror of `_value_matches_schema`. */
export function valueMatchesSchema(value: unknown, schema: Dict): boolean {
  const typeNames = schemaTypeNames(schema);
  if (typeNames.length === 0) {
    return true;
  }
  const allowed = new Set(typeNames);
  if (allowed.has("string") && typeof value === "string") return true;
  if (allowed.has("integer") && typeof value === "number" && Number.isInteger(value)) return true;
  if (allowed.has("number") && typeof value === "number" && Number.isFinite(value)) return true;
  if (allowed.has("boolean") && typeof value === "boolean") return true;
  if (allowed.has("array") && Array.isArray(value)) return true;
  if (allowed.has("object") && isRecord(value)) return true;
  if (allowed.has("file")) return true;
  return false;
}

type InvalidFieldInfo = {
  field: string;
  expected: string[];
  actual: string;
};

function jsTypeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** 每条 requestBody 字段一行摘要，便于模型对齐 JSON 键名（不含 OpenAPI 的 $id/exampleSetFlag 等噪声）。 */
export type InputPropertyFieldHint = {
  name: string;
  type?: string;
  description?: string;
  format?: string;
  required: boolean;
};

export type CompactInputPropertiesHint = {
  required: string[];
  fields: InputPropertyFieldHint[];
};

/** 从完整 JSON Schema 抽出 `properties` 的键名与少量展示字段，用于 INVALID_PARAMETERS 响应体精简。 */
export function compactInputPropertiesHint(rawSchema: unknown): CompactInputPropertiesHint | null {
  const schema = loadJsonSchema(rawSchema);
  if (!schema) return null;
  const properties = schema.properties;
  if (!isRecord(properties)) return null;

  const requiredList = (Array.isArray(schema.required) ? schema.required : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const requiredSet = new Set(requiredList);

  const fields: InputPropertyFieldHint[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    if (!isRecord(prop)) {
      fields.push({ name, required: requiredSet.has(name) });
      continue;
    }
    const types = schemaTypeNames(prop);
    const desc = typeof prop.description === "string" ? prop.description.trim() : "";
    const fmt = typeof prop.format === "string" ? prop.format.trim() : "";
    const hint: InputPropertyFieldHint = {
      name,
      required: requiredSet.has(name),
    };
    if (types.length) hint.type = types.join("|");
    if (desc) hint.description = desc;
    if (fmt) hint.format = fmt;
    fields.push(hint);
  }

  return { required: requiredList, fields };
}

/** Mirror of `_validate_parameters`. Returns an error object or `null`. */
export function validateParameters(params: {
  actionName: string;
  resourceId: string;
  resourceType: string;
  parameters: Dict;
  rawSchema: unknown;
}): ExecutorFailure | null {
  const schema = loadJsonSchema(params.rawSchema);
  if (!schema) return null;

  const properties = schema.properties;
  if (!isRecord(properties)) return null;

  const required = (Array.isArray(schema.required) ? schema.required : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  const missing: string[] = required.filter((key) => {
    const value = params.parameters[key];
    return value === undefined || value === null || value === "";
  });

  const invalid: InvalidFieldInfo[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    if (!(name in params.parameters)) continue;
    const propSchema = isRecord(prop) ? prop : {};
    if (!valueMatchesSchema(params.parameters[name], propSchema)) {
      invalid.push({
        field: name,
        expected: schemaTypeNames(propSchema),
        actual: jsTypeLabel(params.parameters[name]),
      });
    }
  }

  /** 仅承认 `properties` 下的 JSON 键名（如 OpenAPI requestBody 字段 ownerUserCode），禁止用语义 description 当键（如「工号」）。 */
  const unknown: string[] = [];
  const allowExtraKeys = schema.additionalProperties === true;
  if (!allowExtraKeys && Object.keys(properties).length > 0) {
    const allowed = new Set(Object.keys(properties));
    for (const key of Object.keys(params.parameters)) {
      if (!allowed.has(key)) {
        unknown.push(key);
      }
    }
  }

  if (missing.length === 0 && invalid.length === 0 && unknown.length === 0) {
    return null;
  }

  const inputProperties = compactInputPropertiesHint(schema);

  return makeError(
    "INVALID_PARAMETERS",
    `参数不符合 ${params.actionName} 的输入要求，请按返回体 input_properties.fields[].name 作为 JSON 键填写（不要使用 description 文案当键名）`,
    {
      target: {
        resource_id: params.resourceId,
        resource_type: params.resourceType,
        action: params.actionName,
      },
      missing_required_fields: missing,
      invalid_fields: invalid,
      unknown_fields: unknown,
      input_properties: inputProperties ?? { required: [], fields: [] },
      schema_summary: summarizeSchema(schema),
    },
  );
}

/** Mirror of `_extract_backend_parameters`. */
export function extractBackendParameters(payload: Dict): Dict {
  const nestedParams = payload.parameters;
  if (isRecord(nestedParams)) return nestedParams;
  const nestedArgs = payload.arguments;
  if (isRecord(nestedArgs)) return nestedArgs;

  const excluded = new Set([
    "query",
    "message",
    "action",
    "resource_context",
    "agentSseUrl",
  ]);
  const out: Dict = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!excluded.has(k)) {
      out[k] = v;
    }
  }
  return out;
}
