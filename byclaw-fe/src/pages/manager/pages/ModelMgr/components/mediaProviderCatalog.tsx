import { getRuntimeActualUrl } from '@/utils';
import React from 'react';

export type MediaProviderMetadata = {
  adapter?: string;
  modelProtocol?: string;
  apiEndpoint?: string;
  modelCode?: string;
  logo?: string;
  options?: Record<string, unknown>;
};
const catalogs = new Map<string, Map<string, MediaProviderMetadata>>();
const key = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase();
export const isMediaModelType = (type: string) => ['IMAGE_GENERATION', 'TTS', 'ASR'].includes(key(type));
export function providerParamGroup(type: string) {
  const modelType = key(type) || 'LLM';
  return ['LLM', 'RERANK', 'EMBEDDING'].includes(modelType)
    ? 'SYSTEM_MODEL_PROVIDER_NAME'
    : `SYSTEM_MODEL_${modelType}_PROVIDER_NAME`;
}
export function registerProviderCatalog(type: string, rows: any[]) {
  const catalog = new Map<string, MediaProviderMetadata>();
  for (const row of rows) {
    if (!row || typeof row.paramValue !== 'string' || !row.paramValue.trim()) continue;
    try {
      const raw = JSON.parse(row.paramDesc || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const metadata: MediaProviderMetadata = {};
      for (const name of ['adapter', 'modelProtocol', 'apiEndpoint', 'modelCode', 'logo'] as const) {
        if (typeof raw[name] === 'string') metadata[name] = raw[name];
      }
      if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) metadata.options = raw.options;
      catalog.set(key(row.paramValue), metadata);
    } catch {
      // Older dictionaries contain a plain description instead of provider metadata.
    }
  }
  catalogs.set(key(type), catalog);
}
export function getCatalogProviderValues(type: string, provider: string) {
  const meta = catalogs.get(key(type))?.get(key(provider));
  if (!meta || !meta.modelProtocol) return undefined;
  return {
    providerName: provider,
    modelProtocol: meta.modelProtocol,
    apiEndpoint: meta.apiEndpoint || '',
    modelCode: meta.modelCode || '',
    extendParam: meta.options ? JSON.stringify(meta.options, null, 2) : '',
  };
}
export function catalogProtocolOptions(type: string) {
  return Array.from(catalogs.get(key(type))?.values() || [])
    .map((meta) => meta.modelProtocol)
    .filter((value, index, values): value is string => !!value && values.indexOf(value) === index)
    .map((value) => ({ label: value, value }));
}
export function getProviderLogo(type: string, provider: string) {
  const logo = catalogs.get(key(type))?.get(key(provider))?.logo;
  if (logo && (/^https?:\/\//i.test(logo) || !/^[a-z][a-z0-9+.-]*:/i.test(logo))) {
    return getRuntimeActualUrl(logo);
  }
  const assetKey = provider.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return getRuntimeActualUrl(`model-providers/${assetKey}.svg`);
}
export function ProviderLabel({ provider, name, type = 'LLM' }: { provider: string; name: string; type?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <img
        src={getProviderLogo(type, provider)}
        alt=""
        width={20}
        height={20}
        onError={(event) => {
          if (event.currentTarget.dataset.fallback) return;
          event.currentTarget.dataset.fallback = 'true';
          event.currentTarget.src = getRuntimeActualUrl('model-providers/generic.svg');
        }}
      />
      {name}
    </span>
  );
}
