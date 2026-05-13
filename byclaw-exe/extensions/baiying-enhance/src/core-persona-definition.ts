/**
 * 百应 `corePersonaDefinition` 可能是长文本人格，也可能是 JSON 数组（name/key/value 拓展项）。
 */

export type CorePersonaExtension = {
  name?: string;
  key?: string;
  value?: string;
};

export type ParsedCorePersonaDefinition = {
  /** 结构化拓展项；非空时表示不应把原始字符串当作 SOUL 长文本。 */
  extensions: CorePersonaExtension[];
  /** 长文本人格；与 `extensions` 互斥（结构化成功时为空）。 */
  narrativeText: string | undefined;
};

export function parseCorePersonaDefinition(raw: string | undefined): ParsedCorePersonaDefinition {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { extensions: [], narrativeText: undefined };
  }
  const t = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { extensions: [], narrativeText: t };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { extensions: [], narrativeText: t };
  }

  const extensions: CorePersonaExtension[] = [];
  for (const el of parsed) {
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      return { extensions: [], narrativeText: t };
    }
    const o = el as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const value = typeof o.value === "string" ? o.value.trim() : "";
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (!name && !value) {
      continue;
    }
    const ext: CorePersonaExtension = {};
    if (name) ext.name = name;
    if (value) ext.value = value;
    if (key) ext.key = key;
    extensions.push(ext);
  }

  if (extensions.length === 0) {
    return { extensions: [], narrativeText: t };
  }

  return { extensions, narrativeText: undefined };
}
