import enUSMessages from '@/locales/en-US';
import zhCNMessages from '@/locales/zh-CN';
import { mergeLocaleMessages } from './localeRuntime';

export type TerminologyLocaleConfig = {
  singular: string;
  plural: string;
  entry: string;
  market: string;
};

export type BusinessTerminologyConfig = {
  'zh-CN': TerminologyLocaleConfig;
  'en-US': TerminologyLocaleConfig;
};

export const DEFAULT_BUSINESS_TERMINOLOGY: BusinessTerminologyConfig = {
  'zh-CN': {
    singular: '数字员工',
    plural: '数字员工',
    entry: '员工',
    market: '员工市场',
  },
  'en-US': {
    singular: 'Digital Employee',
    plural: 'Digital Employees',
    entry: 'Employees',
    market: 'Employee Marketplace',
  },
};

const AI_EMPLOYEE_MESSAGE_IDS = new Set([
  'employees.title',
  'menu.operation.dashboard',
  'taskOutline.executeToolOrEmployee',
  'assistantSetting.employeeCall',
  'digitalEmployees.unapplyConfirmDesc',
  'headerSearch.applyPermissionTip',
]);

const normalizeValue = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= 40 && !/[{}<>\r\n]/.test(normalized) ? normalized : fallback;
};

const replaceAll = (message: string, source: string, replacement: string) => message.split(source).join(replacement);

const withIndefiniteArticle = (term: string) => `${/^[aeiou]/i.test(term) ? 'an' : 'a'} ${term}`;

export const normalizeBusinessTerminology = (value: unknown): BusinessTerminologyConfig => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }

  const config = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
  const zhCN = config['zh-CN'] || {};
  const enUS = config['en-US'] || {};

  return {
    'zh-CN': {
      singular: normalizeValue(zhCN.singular, DEFAULT_BUSINESS_TERMINOLOGY['zh-CN'].singular),
      plural: normalizeValue(zhCN.plural, DEFAULT_BUSINESS_TERMINOLOGY['zh-CN'].plural),
      entry: normalizeValue(zhCN.entry, DEFAULT_BUSINESS_TERMINOLOGY['zh-CN'].entry),
      market: normalizeValue(zhCN.market, DEFAULT_BUSINESS_TERMINOLOGY['zh-CN'].market),
    },
    'en-US': {
      singular: normalizeValue(enUS.singular, DEFAULT_BUSINESS_TERMINOLOGY['en-US'].singular),
      plural: normalizeValue(enUS.plural, DEFAULT_BUSINESS_TERMINOLOGY['en-US'].plural),
      entry: normalizeValue(enUS.entry, DEFAULT_BUSINESS_TERMINOLOGY['en-US'].entry),
      market: normalizeValue(enUS.market, DEFAULT_BUSINESS_TERMINOLOGY['en-US'].market),
    },
  };
};

const replaceDefaultTerms = (message: string, locale: 'zh-CN' | 'en-US', config: BusinessTerminologyConfig) => {
  const terms = config[locale];
  if (locale === 'zh-CN') {
    return replaceAll(replaceAll(message, '员工市场', terms.market), '数字员工', terms.singular);
  }

  const lowerSingular = terms.singular.toLocaleLowerCase('en-US');
  const withArticles = [
    ['A Digital Employee', withIndefiniteArticle(terms.singular).replace(/^a/, 'A')],
    ['a Digital Employee', withIndefiniteArticle(terms.singular)],
    ['A digital employee', withIndefiniteArticle(lowerSingular).replace(/^a/, 'A')],
    ['a digital employee', withIndefiniteArticle(lowerSingular)],
  ].reduce((result, [source, replacement]) => replaceAll(result, source, replacement), message);

  return [
    ['Digital Employees', terms.plural],
    ['Digital employees', terms.plural],
    ['digital employees', terms.plural.toLocaleLowerCase('en-US')],
    ['Digital Employee', terms.singular],
    ['Digital employee', terms.singular],
    ['digital employee', lowerSingular],
    ['Employee Marketplace', terms.market],
    ['employee marketplace', terms.market.toLocaleLowerCase('en-US')],
    ['Employee Market', terms.market],
    ['employee market', terms.market.toLocaleLowerCase('en-US')],
  ].reduce((result, [source, replacement]) => replaceAll(result, source, replacement), withArticles);
};

const replaceAiEmployeeShortName = (
  id: string,
  message: string,
  locale: 'zh-CN' | 'en-US',
  config: BusinessTerminologyConfig
) => {
  if (!AI_EMPLOYEE_MESSAGE_IDS.has(id)) return message;

  const terms = config[locale];
  if (locale === 'zh-CN') {
    if (id === 'employees.title') return terms.entry;
    if (id === 'menu.operation.dashboard') return `${terms.entry}运营分析`;
    if (id === 'taskOutline.executeToolOrEmployee') return `执行工具/${terms.entry}`;
    if (id === 'assistantSetting.employeeCall') return `${terms.singular}调用`;
    if (id === 'digitalEmployees.unapplyConfirmDesc') return `移除后，您可随时在${terms.market}重新申请使用。`;
    if (id === 'headerSearch.applyPermissionTip') return `请先到${terms.market}申请权限哦～`;
  }

  if (id === 'employees.title') return terms.entry;
  if (id === 'menu.operation.dashboard') return `${terms.entry} Analytics`;
  if (id === 'taskOutline.executeToolOrEmployee') return `Execute Tool/${terms.entry}`;
  if (id === 'assistantSetting.employeeCall') return `${terms.singular} Call`;
  if (id === 'digitalEmployees.unapplyConfirmDesc') {
    return `After removal, you can apply again anytime in the ${terms.market}.`;
  }
  if (id === 'headerSearch.applyPermissionTip') {
    return `Please apply for permission in the ${terms.market} first～`;
  }
  return message;
};

export const transformTerminologyMessages = (
  messages: Record<string, string>,
  locale: 'zh-CN' | 'en-US',
  value: unknown
) => {
  const config = normalizeBusinessTerminology(value);
  return Object.entries(messages).reduce<Record<string, string>>((result, [id, message]) => {
    const replaced = replaceDefaultTerms(message, locale, config);
    result[id] = replaceAiEmployeeShortName(id, replaced, locale, config);
    return result;
  }, {});
};

export const applyBusinessTerminology = (value: unknown) => {
  const config = normalizeBusinessTerminology(value);
  mergeLocaleMessages('zh-CN', transformTerminologyMessages(zhCNMessages, 'zh-CN', config));
  mergeLocaleMessages('en-US', transformTerminologyMessages(enUSMessages, 'en-US', config));
  return config;
};

export const replaceBusinessTerminologyText = (message: string, value: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  replaceDefaultTerms(message, locale, normalizeBusinessTerminology(value));
