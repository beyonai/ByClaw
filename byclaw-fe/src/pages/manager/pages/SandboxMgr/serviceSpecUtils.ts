export interface ServiceSpecConfig {
  serviceKey: string;
  ownerScope?: string;
  displayName?: string;
  serviceType?: string;
  specJson: string;
  templateJson?: string;
  enabled?: number | boolean | string | null;
}

export const isServiceSpecAutoStartEnabled = (spec: ServiceSpecConfig): boolean => {
  try {
    const value = JSON.parse(spec.specJson).runtimeOptions?.lifecycle?.autoStart;
    return value === undefined || value === null || String(value).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
};

export const formatJsonIfValid = (value?: string | null): string => {
  if (!value) return value || '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

export const buildServiceSpecPayload = (spec: ServiceSpecConfig, autoStart: boolean) => {
  const config = JSON.parse(spec.specJson);
  config.runtimeOptions = {
    ...config.runtimeOptions,
    lifecycle: { ...config.runtimeOptions?.lifecycle, autoStart: String(autoStart) },
  };
  return {
    ...spec,
    specJson: JSON.stringify(config),
    templateJson: spec.templateJson,
    enabled: spec.enabled,
  };
};

export type ServiceSpecDimension = 'USER' | 'TENANT' | 'SHARED' | 'TOOL';
export const TOOL_SANDBOX_CONTRACT = 'byclaw.tool-sandbox/v1';
export const MAX_TOOL_COVER_BYTES = 512 * 1024;

const readSpecConfig = (spec: ServiceSpecConfig) => {
  const config = JSON.parse(spec.specJson);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid specification');
  return config;
};

export const getServiceSpecDimension = (spec: ServiceSpecConfig): ServiceSpecDimension => {
  try {
    if (readSpecConfig(spec).runtimeOptions?.toolSandbox?.contract === TOOL_SANDBOX_CONTRACT) return 'TOOL';
  } catch {
    // Invalid specifications remain editable in their ownership category.
  }
  const scope = String(spec.ownerScope || '').toUpperCase();
  return scope === 'TENANT' || scope === 'SHARED' ? scope : 'USER';
};

export const normalizeCapabilities = (value: unknown): string[] => {
  let values = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : value.split(/[,，\n]/);
    } catch {
      values = value.split(/[,，\n]/);
    }
  }
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const isEnabled = (value: unknown) =>
  value === undefined || value === null || !['false', '0'].includes(String(value).toLowerCase().trim());

export const getToolSandboxMetadata = (spec: ServiceSpecConfig) => {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = readSpecConfig(spec).runtimeOptions?.toolSandbox || {};
  } catch {
    // Broken JSON is shown in the editor instead of breaking the catalog.
  }
  return {
    description: typeof metadata.description === 'string' ? metadata.description : '',
    coverImage: typeof metadata.coverImage === 'string' ? metadata.coverImage : '',
    capabilities: normalizeCapabilities(metadata.capabilities),
    enabled: isEnabled(spec.enabled) && isEnabled(metadata.enabled),
  };
};

export const isServiceSpecEnabled = (spec: ServiceSpecConfig) =>
  getServiceSpecDimension(spec) === 'TOOL' ? getToolSandboxMetadata(spec).enabled : isEnabled(spec.enabled);

export const isValidToolCover = (value: string): boolean => {
  if (!value) return true;
  if (value.startsWith('data:')) {
    const match = /^data:image\/(png|jpeg|webp);base64,([a-z\d+/]+={0,2})$/i.exec(value);
    if (!match) return false;
    const body = match[2];
    const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
    return body.length % 4 === 0 && (body.length / 4) * 3 - padding <= MAX_TOOL_COVER_BYTES;
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value.length <= 4096 && !/[\\\s]/.test(value);
  }
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol) && value.length <= 4096;
  } catch {
    return false;
  }
};

export const buildServiceSpecEnabledPayload = (spec: ServiceSpecConfig, enabled: boolean): ServiceSpecConfig => {
  if (getServiceSpecDimension(spec) !== 'TOOL') return { ...spec, enabled: enabled ? 1 : 0 };
  const config = readSpecConfig(spec);
  config.runtimeOptions = {
    ...config.runtimeOptions,
    toolSandbox: { ...config.runtimeOptions?.toolSandbox, enabled: String(enabled) },
  };
  return { ...spec, enabled: enabled ? 1 : 0, specJson: JSON.stringify(config) };
};

export interface ToolSandboxFields {
  description: string;
  coverImage: string;
  capabilities: string[] | string;
  enabled: boolean;
}

export const buildToolSandboxPayload = (spec: ServiceSpecConfig, fields: ToolSandboxFields): ServiceSpecConfig => {
  const config = readSpecConfig(spec);
  config.runtimeOptions = {
    ...config.runtimeOptions,
    toolSandbox: {
      ...config.runtimeOptions?.toolSandbox,
      contract: TOOL_SANDBOX_CONTRACT,
      description: fields.description || '',
      coverImage: fields.coverImage || '',
      capabilities: JSON.stringify(normalizeCapabilities(fields.capabilities)),
      enabled: String(fields.enabled),
    },
  };
  return { ...spec, enabled: fields.enabled ? 1 : 0, specJson: JSON.stringify(config) };
};
