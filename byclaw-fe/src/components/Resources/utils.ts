import { ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES, ALL_RESOURCE_BIZ_TYPE_VALUES } from './constants';

const KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES = ['KG_DOC', 'KG_QA', 'KG_TERM'];

export const SKILL_MARKETPLACE_INSTALLED_MESSAGE_TYPE = 'BYCLAW_SKILL_INSTALLED';

export const buildSkillMarketplaceUrl = (
  marketplaceBaseUrl?: string | null,
  beyondToken?: string | null,
  parentOrigin?: string | null
) => {
  const configuredUrl = `${marketplaceBaseUrl ?? ''}`.trim();
  if (!configuredUrl) {
    return '';
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return '';
  }

  url.searchParams.delete('digId');
  url.searchParams.delete('beyondToken');
  if (`${beyondToken ?? ''}`.trim()) {
    url.searchParams.set('BeyondToken', `${beyondToken}`.trim());
  }
  if (`${parentOrigin ?? ''}`.trim()) {
    url.searchParams.set('parentOrigin', `${parentOrigin}`.trim());
  }
  return url.toString();
};

export const isSkillMarketplaceInstalledMessage = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const message = payload as Record<string, unknown>;
  return message.type === SKILL_MARKETPLACE_INSTALLED_MESSAGE_TYPE;
};

const getAllResourceBizTypeValues = (resourceType?: string) =>
  resourceType === 'KG_DOC' ? ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES : ALL_RESOURCE_BIZ_TYPE_VALUES;

export const isAllResourceBizTypeSelected = (resourceBizTypeList?: string[], resourceType?: string) => {
  const allValues = getAllResourceBizTypeValues(resourceType);
  if (!Array.isArray(resourceBizTypeList) || resourceBizTypeList.length === 0) {
    return true;
  }

  return (
    resourceBizTypeList.length === allValues.length && allValues.every((value) => resourceBizTypeList.includes(value))
  );
};

export const normalizeResourceBizTypeList = (resourceBizTypeList?: string[], resourceType?: string) => {
  return isAllResourceBizTypeSelected(resourceBizTypeList, resourceType)
    ? [...getAllResourceBizTypeValues(resourceType)]
    : resourceBizTypeList;
};

export const getBaseResourceBizTypeList = (resourceType: string) => {
  if (resourceType === 'KG_DOC') {
    return [...KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES];
  }

  return resourceType === 'TOOL' ? [...ALL_RESOURCE_BIZ_TYPE_VALUES] : [resourceType];
};

export const buildResourceListFilterParam = (activeTab: string, filterParam?: Record<string, any>) => {
  const ignoredKeys = new Set(['deptBelong', 'customBelong']);
  if (activeTab === 'personal') {
    ignoredKeys.add('belong');
    ignoredKeys.add('orgFilters');
  }

  return Object.entries(filterParam || {}).reduce((acc, [key, value]) => {
    if (ignoredKeys.has(key)) {
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {} as Record<string, any>);
};
