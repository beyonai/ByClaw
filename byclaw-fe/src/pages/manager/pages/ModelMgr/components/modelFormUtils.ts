export type DebugInputMode = 'template' | 'auto';

export type ModelTagItem = {
  param_name?: string;
  param_value?: string;
  standDisplayValue?: string;
  standCode?: string;
  [key: string]: any;
};

export const SYSTEM_SOURCE_TYPES = ['DIG_EMPLOYEE'];
export const DEFAULT_CONTEXT_TOKENS = 1024 * 198;
export const MAX_CONTEXT_TOKENS = 2000 * 1000;
export const DEFAULT_MAX_TOKENS = 1024 * 64;
export const THINKING_LEVEL_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const;
export const THINKING_CAPABILITY_OPTIONS = ['unsupported', 'binary', 'effort', 'budget', 'adaptive'] as const;
export const THINKING_COMPAT_FORMAT_OPTIONS = [
  'auto',
  'openai',
  'qwen',
  'qwen-chat-template',
  'deepseek',
  'openrouter',
  'together',
  'zai',
  'anthropic',
] as const;

export const DEFAULT_REASONING_CONFIG = {
  enabled: false,
  defaultLevel: 'off',
  capability: 'unsupported',
  compatFormat: 'auto',
  supportedEfforts: [],
  budgets: {},
};

export const tokenMarks = Array.from({ length: 4 }, (_, index) => {
  const value = (index + 1) * 500 * 1000;
  return [value, `${value / 1000}K`];
}).reduce<Record<number, string>>((marks, [value, label]) => {
  marks[value as number] = label as string;
  return marks;
}, {});

export function buildDebugDefaults(intl: any) {
  return {
    defaultUserMessage: intl.formatMessage({ id: 'modelMgr.modal.debugDefaultUserMessage' }),
    defaultRerankQuery: intl.formatMessage({ id: 'modelMgr.modal.debugRerankQuery' }),
    defaultRerankDocs: [
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc1' }), metadata: { id: 0 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc2' }), metadata: { id: 1 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc3' }), metadata: { id: 2 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc4' }), metadata: { id: 3 }, score: 0 },
    ],
  };
}

export const MODEL_PROTOCOL_OPTIONS = [
  { label: 'OpenAI', value: 'OpenAI' },
  { label: 'OpenAI Responses', value: 'OpenAI Responses' },
  { label: 'Anthropic', value: 'Anthropic' },
] as const;

export function getDefaultLlmDebugSuffix(modelProtocol?: any) {
  const protocol = `${modelProtocol ?? 'OpenAI'}`.trim().toLowerCase();
  if (protocol === 'anthropic') return '/v1/messages';
  return '/chat/completions';
}

export function getApiEndpointPlaceholder(modelProtocol?: any) {
  const protocol = `${modelProtocol ?? 'OpenAI'}`.trim().toLowerCase();
  if (protocol === 'anthropic') return 'https://api.example.com/anthropic';
  return 'https://api.example.com/v1';
}

export function getDefaultFormValues() {
  return {
    status: 'ENABLED',
    abilities: [],
    systems: [],
    modelType: 'LLM',
    modelProtocol: 'OpenAI',
    apiEndpoint: 'https://api.example.com/v1',
    headers: [{ key: '', value: '' }],
    connectTimeoutSec: 32,
    readTimeoutSec: 60,
    maxRetries: 3,
    retryIntervalSec: 1,
    contextTokens: DEFAULT_CONTEXT_TOKENS,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: DEFAULT_MAX_TOKENS,
    frequencyPenalty: 0,
    presencePenalty: 0,
    reasoningConfig: { ...DEFAULT_REASONING_CONFIG },
    reasoningEffortMapText: '',
  };
}

export function normalizeModelType(v: any) {
  if (v === 1 || v === '1') return 'LLM';
  if (v === 2 || v === '2') return 'RERANK';
  if (typeof v === 'string' && v.trim()) return v.trim();
  return 'LLM';
}

export function joinUrl(base: string, path: string) {
  const b = `${base || ''}`.trim().replace(/\/+$/, '');
  const p = `${path || ''}`.trim();
  if (!b) return p || '';
  if (!p) return b;
  if (p.startsWith('/')) return `${b}${p}`;
  return `${b}/${p}`;
}

function normalizeRerankBase(apiEndpoint: string) {
  let base = `${apiEndpoint || ''}`.trim();
  base = base.replace(/\/r\/e\/r\/a\/n\/k(\/rerank)?\/?$/i, '');
  base = base.replace(/\/rerank\/?$/i, '');
  base = base.replace(/\/+$/, '');
  return base;
}

function normalizeRerankSuffix(suffix: string) {
  let s = `${suffix || ''}`.trim();
  if (!s) return '/rerank';
  s = s.replace(/\/r\/e\/r\/a\/n\/k/gi, '/rerank');
  s = s.replace(/\/rerank(\/rerank)+/gi, '/rerank');
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

export function headersListToObject(list: any) {
  const arr = Array.isArray(list) ? list : [];
  const obj: Record<string, string> = {};
  arr.forEach((it) => {
    const k = `${it?.key ?? ''}`.trim();
    const v = `${it?.value ?? ''}`;
    if (!k) return;
    obj[k] = v;
  });
  return obj;
}

export function buildLlmHeaders(options: { formApiToken?: any; formHeaders?: any; prevHeaders?: any }) {
  const { formApiToken, formHeaders, prevHeaders } = options;
  const formObj = headersListToObject(formHeaders);
  const prevObj =
    prevHeaders && typeof prevHeaders === 'object' && !Array.isArray(prevHeaders) ? (prevHeaders as any) : {};

  const next: Record<string, string> = {};
  const authFromPrev = typeof prevObj.Authorization === 'string' ? prevObj.Authorization : '';
  const authFromFormHeader = typeof formObj.Authorization === 'string' ? formObj.Authorization : '';
  const token = `${formApiToken ?? ''}`.trim();
  const authFromToken = token ? `Bearer ${token}` : '';
  const auth = authFromFormHeader || authFromToken || authFromPrev;

  Object.keys(formObj).forEach((k) => {
    if (k === 'Authorization') return;
    next[k] = formObj[k];
  });
  if (auth) next.Authorization = auth;

  return next;
}

export function buildRerankHeaders(options: { formApiToken?: any; formHeaders?: any; prevHeaders?: any }) {
  const { formApiToken, formHeaders, prevHeaders } = options;
  const formObj = headersListToObject(formHeaders);
  const prevObj =
    prevHeaders && typeof prevHeaders === 'object' && !Array.isArray(prevHeaders) ? (prevHeaders as any) : {};

  const next: Record<string, string> = {};
  const keyFromPrev = typeof prevObj['X-Api-Key'] === 'string' ? prevObj['X-Api-Key'] : '';
  const keyFromFormHeader = typeof formObj['X-Api-Key'] === 'string' ? formObj['X-Api-Key'] : '';
  const token = `${formApiToken ?? ''}`.trim();
  const keyFromToken = token ? `${token}` : '';
  const apiKey = keyFromFormHeader || keyFromToken || keyFromPrev;

  Object.keys(formObj).forEach((k) => {
    if (k === 'X-Api-Key') return;
    next[k] = formObj[k];
  });
  if (apiKey) next['X-Api-Key'] = apiKey;

  return next;
}

function safeParseJsonObject(text: string): any | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

export function formatReasoningEffortMapText(reasoningConfig?: any) {
  const effortMap = reasoningConfig?.effortMap;
  if (!effortMap || typeof effortMap !== 'object' || Array.isArray(effortMap)) {
    return '';
  }
  return JSON.stringify(effortMap, null, 2);
}

function safeParseReasoningEffortMap(text: any) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const parsed = safeParseJsonObject(text);
  if (!parsed) return undefined;
  const out: Record<string, string> = {};
  Object.keys(parsed).forEach((key) => {
    const k = `${key}`.trim();
    const v = `${parsed[key] ?? ''}`.trim();
    if (k && v) {
      out[k] = v;
    }
  });
  return Object.keys(out).length ? out : undefined;
}

export function buildReasoningConfigPayload(values: any) {
  const raw = values?.reasoningConfig && typeof values.reasoningConfig === 'object' ? values.reasoningConfig : {};
  const capability = `${raw.capability ?? DEFAULT_REASONING_CONFIG.capability}`.trim() || 'unsupported';
  const enabled = Boolean(raw.enabled) && capability !== 'unsupported';
  const next: Record<string, any> = {
    enabled,
    defaultLevel: enabled ? `${raw.defaultLevel ?? 'medium'}` : 'off',
    capability,
    compatFormat: `${raw.compatFormat ?? 'auto'}`,
  };
  if (!enabled) {
    return next;
  }
  if (Array.isArray(raw.supportedEfforts) && raw.supportedEfforts.length) {
    next.supportedEfforts = raw.supportedEfforts;
  }
  const effortMap = safeParseReasoningEffortMap(values?.reasoningEffortMapText);
  if (effortMap) {
    next.effortMap = effortMap;
  }
  if (raw.budgets && typeof raw.budgets === 'object' && !Array.isArray(raw.budgets)) {
    const budgets: Record<string, number> = {};
    Object.keys(raw.budgets).forEach((level) => {
      const value = Number(raw.budgets[level]);
      if (Number.isFinite(value) && value > 0) {
        budgets[level] = Math.floor(value);
      }
    });
    if (Object.keys(budgets).length) {
      next.budgets = budgets;
    }
  }
  return next;
}

function getReasoningBudget(reasoningConfig: any, level: string) {
  const value = reasoningConfig?.budgets?.[level];
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function resolveDebugReasoningEffort(reasoningConfig: any, effortMapText: any, defaultLevel: string) {
  const effortMap = safeParseReasoningEffortMap(effortMapText);
  if (effortMap?.[defaultLevel]) return effortMap[defaultLevel];
  if (defaultLevel === 'minimal' || defaultLevel === 'low' || defaultLevel === 'medium') return 'high';
  if (defaultLevel === 'adaptive') return 'medium';
  if (defaultLevel === 'xhigh' || defaultLevel === 'max') return 'max';
  return defaultLevel;
}

function applyReasoningDebugParams(req: Record<string, any>, formValues: any) {
  const reasoningConfig = formValues?.reasoningConfig || {};
  const capability = `${reasoningConfig?.capability ?? 'unsupported'}`.trim().toLowerCase();
  const defaultLevel = `${reasoningConfig?.defaultLevel ?? 'off'}`.trim().toLowerCase();
  const enabled = Boolean(reasoningConfig?.enabled) && capability !== 'unsupported' && defaultLevel !== 'off';
  if (!enabled) {
    req.enable_thinking = false;
    req.chat_template_kwargs = { enable_thinking: false };
    return;
  }
  const compatFormat = `${reasoningConfig?.compatFormat ?? 'auto'}`.trim().toLowerCase();
  if (['deepseek', 'openai', 'openrouter', 'zai'].includes(compatFormat)) {
    req.reasoning_effort = resolveDebugReasoningEffort(
      reasoningConfig,
      formValues?.reasoningEffortMapText,
      defaultLevel
    );
    return;
  }
  if (compatFormat === 'together') {
    req.reasoning = { enabled: true };
    return;
  }
  if (compatFormat === 'qwen') {
    req.enable_thinking = true;
    const budget = getReasoningBudget(reasoningConfig, defaultLevel);
    if (budget) req.thinking_budget = budget;
    return;
  }
  if (compatFormat === 'qwen-chat-template') {
    req.chat_template_kwargs = { enable_thinking: true };
    const budget = getReasoningBudget(reasoningConfig, defaultLevel);
    if (budget) req.thinking_budget = budget;
    return;
  }
  if (compatFormat === 'anthropic') {
    if (defaultLevel === 'adaptive') {
      req.thinking = { type: 'adaptive', display: 'summarized' };
      return;
    }
    const budget = getReasoningBudget(reasoningConfig, defaultLevel);
    req.thinking = budget ? { type: 'enabled', budget_tokens: budget } : { type: 'enabled' };
    return;
  }
  req.enable_thinking = true;
  req.chat_template_kwargs = { enable_thinking: true };
}

export function buildAutoDebugRequestText(options: {
  formValues: any;
  id?: string;
  prevText?: string;
  changedKeys?: string[];
  previousApiEndpoint?: string;
  defaultUserMessage?: string;
  defaultRerankQuery?: string;
  defaultRerankDocs?: Array<{ text: string; metadata: { id: number }; score: number }>;
}) {
  const {
    formValues,
    id,
    prevText,
    changedKeys,
    previousApiEndpoint,
    defaultUserMessage,
    defaultRerankQuery,
    defaultRerankDocs,
  } = options;
  const prevObj = prevText ? safeParseJsonObject(prevText) : null;
  const modelType = normalizeModelType(formValues?.modelType);
  const isTypeSwitch = Array.isArray(changedKeys) && changedKeys.includes('modelType');
  if (modelType === 'LLM') {
    const apiEndpoint = `${formValues?.apiEndpoint ?? ''}`.trim();
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    const isProtocolSwitch = Array.isArray(changedKeys) && changedKeys.includes('modelProtocol');
    let suffix = getDefaultLlmDebugSuffix(formValues?.modelProtocol);
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (
      !isTypeSwitch &&
      !isProtocolSwitch &&
      endpointNotShortened &&
      prevUrl &&
      apiEndpoint &&
      prevUrl.startsWith(apiEndpoint)
    ) {
      suffix = prevUrl.slice(apiEndpoint.length) || suffix;
    }
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildLlmHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultMessages = [{ role: 'user', content: defaultUserMessage ?? '今天天气如何' }];
    const messages =
      !isTypeSwitch && Array.isArray(prevObj?.messages) && prevObj.messages.length
        ? prevObj.messages
        : prevText && `${prevText}`.trim() && !prevObj
          ? [{ role: 'user', content: `${prevText}` }]
          : defaultMessages;

    const temperature = !isTypeSwitch && typeof prevObj?.temperature === 'number' ? prevObj.temperature : 0.1;
    const stream = !isTypeSwitch && typeof prevObj?.stream === 'boolean' ? prevObj.stream : true;

    const req: Record<string, any> = {
      url,
      headers: Object.keys(headersObj).length ? headersObj : {},
      model: modelNoOrCode,
      messages,
      temperature,
      stream,
    };
    applyReasoningDebugParams(req, formValues);
    return JSON.stringify(req, null, 2);
  }

  if (modelType === 'RERANK') {
    const apiEndpointRaw = `${formValues?.apiEndpoint ?? ''}`.trim();
    const apiEndpoint = normalizeRerankBase(apiEndpointRaw);
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/rerank';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (!isTypeSwitch && endpointNotShortened && prevUrl && apiEndpoint && prevUrl.startsWith(apiEndpoint)) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    suffix = normalizeRerankSuffix(suffix);
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildRerankHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultQuery = defaultRerankQuery ?? '北京旅游攻略';
    const defaultDocs =
      defaultRerankDocs && defaultRerankDocs.length >= 4
        ? defaultRerankDocs
        : [
          { text: '北京美食推荐', metadata: { id: 0 }, score: 0 },
          { text: '天津旅游攻略', metadata: { id: 1 }, score: 0 },
          { text: '小白开发教程', metadata: { id: 2 }, score: 0 },
          { text: '故宫游玩攻略', metadata: { id: 3 }, score: 0 },
        ];

    const query =
      !isTypeSwitch && typeof prevObj?.query === 'string' && prevObj.query.trim() ? prevObj.query : defaultQuery;
    const docs = !isTypeSwitch && Array.isArray(prevObj?.docs) && prevObj.docs.length ? prevObj.docs : defaultDocs;

    const req: Record<string, any> = {
      url,
      headers: Object.keys(headersObj).length ? headersObj : {},
      model: modelNoOrCode,
      query,
      docs,
    };

    if (!isTypeSwitch && prevObj) {
      const knownKeys = Object.keys(req);
      Object.keys(prevObj)
        .filter((k) => !knownKeys.includes(k))
        .filter((k) => !['messages', 'stream', 'temperature'].includes(k))
        .sort()
        .forEach((k) => {
          req[k] = prevObj[k];
        });
    }

    return JSON.stringify(req, null, 2);
  }

  if (modelType === 'EMBEDDING') {
    const apiEndpoint = `${formValues?.apiEndpoint ?? ''}`.trim();
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/embeddings';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (!isTypeSwitch && endpointNotShortened && prevUrl && apiEndpoint && prevUrl.startsWith(apiEndpoint)) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildLlmHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultInput = '今天天气如何';
    const inputText =
      !isTypeSwitch && typeof prevObj?.input === 'string' && prevObj.input.trim() ? prevObj.input : defaultInput;

    return JSON.stringify(
      {
        url,
        headers: Object.keys(headersObj).length ? headersObj : {},
        model: modelNoOrCode,
        input: inputText,
      },
      null,
      2
    );
  }

  const prevInput =
    typeof prevObj?.input === 'string' ? prevObj.input : prevText && `${prevText}`.trim() ? `${prevText}` : '';
  const prevVariables =
    prevObj?.variables && typeof prevObj.variables === 'object' && !Array.isArray(prevObj.variables)
      ? prevObj.variables
      : {};

  const req: Record<string, any> = {
    ...(id ? { id } : undefined),
    input: prevInput,
    variables: prevVariables,
    apiEndpoint: formValues?.apiEndpoint ?? '',
    apiToken: formValues?.apiToken ?? '',
    modelCode: formValues?.modelCode ?? 'gpt-3.5-turbo',
    modelType,
    headers: Array.isArray(formValues?.headers) ? formValues.headers : [],
    connectTimeoutSec: formValues?.connectTimeoutSec,
    readTimeoutSec: formValues?.readTimeoutSec,
    temperature: formValues?.temperature,
    maxTokens: formValues?.maxTokens,
    topP: formValues?.topP,
  };

  if (prevObj) {
    const knownKeys = Object.keys(req);
    Object.keys(prevObj)
      .filter((k) => !knownKeys.includes(k))
      .sort()
      .forEach((k) => {
        req[k] = prevObj[k];
      });
  }

  return JSON.stringify(req, null, 2);
}

export function extractModelId(res: any) {
  return res?.data?.id ?? res?.id ?? res?.resourceId ?? res?.data?.resourceId ?? res?.result?.id ?? undefined;
}
