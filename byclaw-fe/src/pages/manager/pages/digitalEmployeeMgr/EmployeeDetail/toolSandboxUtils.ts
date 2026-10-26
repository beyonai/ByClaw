/**
 * The tool sandbox an employee's commands run in, kept as one entry of the
 * employee's advanced settings (`advancedSettings`, a JSON array):
 * `{ key: 'toolSandbox', value: '<sandbox_service_spec.service_key>' }`.
 * No entry means the default tool sandbox. The DSH host reads the same entry.
 */
export const TOOL_SANDBOX_KEY = 'toolSandbox';

export interface ServiceSpecRow {
  serviceKey?: string | null;
  displayName?: string | null;
  enabled?: number | string | boolean | null;
}

export interface ToolSandboxOption {
  value: string;
  label: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Parse the raw advanced settings (string or array) into an array; anything else is empty. */
export const parseAdvancedSettings = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** The selected tool sandbox spec, or undefined for the default. */
export const readToolSandbox = (advancedSettings: unknown): string | undefined => {
  const entries = Array.isArray(advancedSettings) ? advancedSettings : parseAdvancedSettings(advancedSettings);
  for (const entry of entries) {
    if (isRecord(entry) && entry.key === TOOL_SANDBOX_KEY) {
      const value = text(entry.value);
      return value === '' ? undefined : value;
    }
  }
  return undefined;
};

/** Advanced settings with the selection written in (or removed when empty); other entries untouched. */
export const writeToolSandbox = (advancedSettings: unknown, value: string | undefined): unknown[] => {
  const entries = (Array.isArray(advancedSettings) ? advancedSettings : parseAdvancedSettings(advancedSettings)).filter(
    (entry) => !(isRecord(entry) && entry.key === TOOL_SANDBOX_KEY),
  );
  const selected = text(value);
  return selected === '' ? entries : [...entries, { key: TOOL_SANDBOX_KEY, value: selected }];
};

/** Specs not open for login (`enabled = 0`) are the tool sandboxes a DSH host starts on demand. */
export const isToolSandboxSpec = (row: ServiceSpecRow): boolean => {
  const { enabled } = row;
  if (enabled === 0 || enabled === false) return true;
  return typeof enabled === 'string' && (enabled.trim() === '0' || enabled.trim().toLowerCase() === 'false');
};

export const buildToolSandboxOptions = (rows: ServiceSpecRow[] | undefined | null): ToolSandboxOption[] =>
  (rows || [])
    .filter((row) => isToolSandboxSpec(row) && text(row.serviceKey) !== '')
    .map((row) => ({ value: text(row.serviceKey), label: text(row.displayName) || text(row.serviceKey) }));
