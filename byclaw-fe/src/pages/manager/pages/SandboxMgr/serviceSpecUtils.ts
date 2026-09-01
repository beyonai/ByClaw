export interface ServiceSpecConfig {
  serviceKey: string;
  specJson: string;
  templateJson?: string;
  enabled?: number | boolean | string | null;
}

export const isServiceSpecAutoStartEnabled = (value: ServiceSpecConfig['enabled']): boolean => {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== '0' && value.toLowerCase() !== 'false';
};

export const buildServiceSpecPayload = (spec: ServiceSpecConfig, enabled: boolean) => ({
  serviceKey: spec.serviceKey,
  specJson: spec.specJson,
  templateJson: spec.templateJson,
  enabled: enabled ? 1 : 0,
});
