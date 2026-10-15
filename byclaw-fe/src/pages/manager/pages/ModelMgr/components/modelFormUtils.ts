import {
  getImageGenerationProviderByProtocol,
  getImageProviderFormValues,
  resolveImageGenerationProviderName,
} from './imageGenerationProviders';
import { buildVolcengineImageParam, compactImageGenerationConfig, isVolcengineImage } from './volcengineImageConfig';

export type DebugInputMode = 'template' | 'auto';

export type ModelTagItem = {
  param_name?: string;
  param_value?: string;
  standDisplayValue?: string;
  standCode?: string;
  [key: string]: any;
};

export const SYSTEM_SOURCE_TYPES = ['DIG_EMPLOYEE'];
// 前端缺少官方上下文上限时的配置默认值，不作为官方容量校验依据。
export const DEFAULT_CONTEXT_TOKENS = 202752;
export const MAX_CONTEXT_TOKENS = 2000 * 1000;
export const MIN_CONTEXT_TOKENS = 1;
export const CONTEXT_TOKENS_CONFIG = {
  min: MIN_CONTEXT_TOKENS,
  max: MAX_CONTEXT_TOKENS,
  step: 1000,
};
export const DEFAULT_MAX_TOKENS = 1024 * 64;
export const MIN_MAX_TOKENS = 1;

/** 缺少输出配置时使用系统预算；已知窗口较小时收窄默认值，不将预算当作官方上限。 */
export function getDefaultMaxTokens(contextTokens?: number | string) {
  const context = Number(contextTokens);
  return Number.isInteger(context) && context > 0 ? Math.min(DEFAULT_MAX_TOKENS, context) : DEFAULT_MAX_TOKENS;
}

export const IMAGE_GENERATION_DEFAULTS = {
  ...getImageProviderFormValues('MINIMAX'),
  prompt: '',
  aspectRatio: '1:1',
  imageCount: 1,
  responseFormat: 'url',
};
export const THINKING_LEVEL_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const;
export const THINKING_CAPABILITY_OPTIONS = ['unsupported', 'binary', 'effort', 'budget', 'adaptive'] as const;
export const THINKING_COMPAT_FORMAT_OPTIONS = [
  'auto',
  'openai',
  'qwen',
  'bailian',
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
  { label: 'Qwen', value: 'Qwen' },
  { label: 'Volcengine Multimodal', value: 'Volcengine Multimodal' },
  { label: 'MiniMax Image', value: 'MINIMAX_IMAGE' },
] as const;

export function getDefaultLlmDebugSuffix(modelProtocol?: any) {
  const protocol = `${modelProtocol ?? 'OpenAI'}`.trim().toLowerCase();
  if (protocol === 'anthropic') return '/v1/messages';
  if (protocol === 'openai responses') return '/responses';
  return '/chat/completions';
}

export function getApiEndpointPlaceholder(modelProtocol?: any) {
  const protocol = `${modelProtocol ?? 'OpenAI'}`.trim().toLowerCase();
  if (protocol === 'anthropic') return 'https://api.example.com/anthropic';
  const imageProvider = getImageGenerationProviderByProtocol(modelProtocol);
  if (imageProvider) return imageProvider.apiEndpoint;
  return 'https://api.example.com/v1';
}

/** 判断当前值是否仅为协议示例占位，切换协议时应清空以便展示新 placeholder。 */
export function isExampleApiEndpointPlaceholder(value?: any) {
  const normalized = `${value ?? ''}`.trim().replace(/\/+$/, '');
  if (!normalized) return true;
  return normalized === 'https://api.example.com/v1' || normalized === 'https://api.example.com/anthropic';
}

export function getImageProviderTransitionFormValues(providerName?: any, currentValues?: any) {
  // 清空提供商只按现有协议补全，不能触发 MiniMax 预设覆盖自定义地址、型号和协议。
  if (!`${providerName ?? ''}`.trim()) {
    return { providerName: resolveImageGenerationProviderName(undefined, currentValues?.modelProtocol) };
  }
  const next = getImageProviderFormValues(providerName);
  const previous = getImageGenerationProviderByProtocol(currentValues?.modelProtocol);
  if (!currentValues || (next.providerName !== 'VOLCENGINE' && previous?.providerName !== 'VOLCENGINE')) return next;
  // 新火山分支只替换空值或上一提供商预设值，保留用户填写的型号和代理地址。
  return {
    providerName: next.providerName,
    modelProtocol: next.modelProtocol,
    apiEndpoint:
      !currentValues.apiEndpoint || currentValues.apiEndpoint === previous?.apiEndpoint
        ? next.apiEndpoint
        : currentValues.apiEndpoint,
    modelCode:
      !currentValues.modelCode || currentValues.modelCode === previous?.modelCode
        ? next.modelCode
        : currentValues.modelCode,
  };
}

export function getImageGenerationDefaultFormValues() {
  return { ...IMAGE_GENERATION_DEFAULTS };
}

export function getDefaultFormValues() {
  return {
    status: 'ENABLED',
    abilities: [],
    systems: [],
    applicabilityScope: '',
    modelType: 'LLM',
    modelProtocol: 'OpenAI',
    // 仅靠 placeholder 展示样例，不预填实际默认值。
    apiEndpoint: '',
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

export function getModelTypeSwitchFormValues(modelType: any) {
  const normalizedType = normalizeModelType(modelType);
  if (normalizedType === 'IMAGE_GENERATION') {
    return {
      ...getImageGenerationDefaultFormValues(),
      modelType: normalizedType,
      imageGenerationConfig: undefined,
      apiToken: '',
      headers: [{ key: '', value: '' }],
    };
  }

  const isOpenAiCompatible = normalizedType === 'LLM' || normalizedType === 'EMBEDDING';
  return {
    modelType: normalizedType,
    providerName: isOpenAiCompatible ? 'OpenAI' : undefined,
    modelProtocol: isOpenAiCompatible ? 'OpenAI' : undefined,
    // 非文生图类型不预填示例地址，由 placeholder 按协议提示。
    apiEndpoint: '',
    modelCode: '',
    apiToken: '',
    headers: [{ key: '', value: '' }],
    prompt: undefined,
    imageGenerationConfig: undefined,
    aspectRatio: undefined,
    imageCount: undefined,
    responseFormat: undefined,
    promptOptimizer: undefined,
    seed: undefined,
  };
}

export function getModelTypeTransitionFormValues(previousModelType: any, nextModelType: any) {
  const previousType = normalizeModelType(previousModelType);
  const nextType = normalizeModelType(nextModelType);
  if (previousType !== 'IMAGE_GENERATION' && nextType !== 'IMAGE_GENERATION') {
    return { modelType: nextType };
  }
  return getModelTypeSwitchFormValues(nextType);
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

export function buildDebugPayload(values: any) {
  if (values?.modelProtocol === 'BAILIAN_IMAGE' || values?.modelProtocol === 'TOKENHUB_IMAGE') {
    const model = `${values?.modelCode || ''}`.trim();
    const prompt = `${values?.prompt ?? ''}`;
    const bailian = values.modelProtocol === 'BAILIAN_IMAGE';
    // 专用图片协议使用各自的消息结构，不发送 MiniMax 的 aspect_ratio/response_format。
    const param = bailian
      ? { model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { n: 1 } }
      : model === 'hy-image-v3.5-preview'
      ? { model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] }
      : { model, prompt };
    return {
      input: {
        providerName: values.providerName,
        modelProtocol: values.modelProtocol,
        url: `${values?.apiEndpoint || ''}`.trim(),
        headers: buildLlmHeaders({ formApiToken: values.apiToken, formHeaders: values.headers }),
        param,
      },
    };
  }
  if (isVolcengineImage(values)) {
    return {
      input: {
        providerName: 'VOLCENGINE',
        modelProtocol: 'VOLCENGINE_IMAGE',
        url: `${values?.apiEndpoint || ''}`.trim(),
        headers: buildLlmHeaders({
          formApiToken: values?.apiToken,
          formHeaders: values?.headers,
          prevHeaders: values?.prevHeaders,
        }),
        param: buildVolcengineImageParam(values),
      },
    };
  }
  const imageCount = Number(values?.imageCount ?? values?.n);
  const seed = Number(values?.seed);
  const param: Record<string, any> = {
    model: `${values?.modelCode || IMAGE_GENERATION_DEFAULTS.modelCode}`.trim(),
    prompt: `${values?.prompt ?? ''}`,
    aspect_ratio: `${values?.aspectRatio || IMAGE_GENERATION_DEFAULTS.aspectRatio}`,
    response_format: `${values?.responseFormat || IMAGE_GENERATION_DEFAULTS.responseFormat}`,
    n: Number.isFinite(imageCount) && imageCount > 0 ? Math.floor(imageCount) : IMAGE_GENERATION_DEFAULTS.imageCount,
  };
  if (typeof values?.promptOptimizer === 'boolean') {
    param.prompt_optimizer = values.promptOptimizer;
  }
  if (Number.isFinite(seed)) {
    param.seed = Math.floor(seed);
  }

  return {
    input: {
      providerName: 'MINIMAX',
      modelProtocol: 'MINIMAX_IMAGE',
      url: `${values?.apiEndpoint || IMAGE_GENERATION_DEFAULTS.apiEndpoint}`.trim(),
      headers: buildLlmHeaders({
        formApiToken: values?.apiToken,
        formHeaders: values?.headers,
        prevHeaders: values?.prevHeaders,
      }),
      param,
    },
  };
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

export function hasImageGenerationPrompt(input: any) {
  const parsed = typeof input === 'string' ? safeParseJsonObject(input) : input;
  return typeof parsed?.param?.prompt === 'string' && parsed.param.prompt.trim().length > 0;
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

export function buildModelUpsertPayload(options: {
  values: any;
  type?: string;
  dataId?: string | number;
  savedNewId?: string | number;
}) {
  const { values, type, dataId, savedNewId } = options;
  const restValues = { ...(values || {}) };
  if (normalizeModelType(values?.modelType) === 'IMAGE_GENERATION') {
    restValues.providerName = resolveImageGenerationProviderName(values?.providerName, values?.modelProtocol);
  }
  [
    'reasoningEffortMapText',
    'prompt',
    'aspectRatio',
    'imageCount',
    'responseFormat',
    'promptOptimizer',
    'seed',
  ].forEach((key) => delete restValues[key]);
  const imageConfig = compactImageGenerationConfig(restValues.imageGenerationConfig);
  if (imageConfig) restValues.imageGenerationConfig = imageConfig;
  else delete restValues.imageGenerationConfig;

  const id =
    type === 'edit' || type === 'debug'
      ? dataId
      : type === 'add' && savedNewId !== null && savedNewId !== undefined
      ? savedNewId
      : undefined;

  return {
    ...(id !== null && id !== undefined ? { id } : {}),
    ...restValues,
    reasoningConfig: buildReasoningConfigPayload(values),
    modelType: normalizeModelType(values?.modelType),
  };
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
  // Bailian is an explicit wire format; keep legacy Qwen behavior unchanged.
  if (`${reasoningConfig?.compatFormat ?? ''}`.trim().toLowerCase() === 'bailian') {
    req.enable_thinking = enabled;
    if (enabled && capability === 'effort') {
      const map = safeParseReasoningEffortMap(formValues?.reasoningEffortMapText) ?? reasoningConfig?.effortMap;
      const effort = map?.[defaultLevel] ?? defaultLevel;
      if (effort !== 'adaptive') req.reasoning_effort = effort;
    } else if (enabled && capability === 'budget') {
      const budget = getReasoningBudget(reasoningConfig, defaultLevel);
      if (budget) req.thinking_budget = budget;
    }
    return;
  }
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
  syncFormParameters?: boolean;
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
    syncFormParameters = false,
    defaultUserMessage,
    defaultRerankQuery,
    defaultRerankDocs,
  } = options;
  const prevObj = prevText ? safeParseJsonObject(prevText) : null;
  const modelType = normalizeModelType(formValues?.modelType);
  const isTypeSwitch = Array.isArray(changedKeys) && changedKeys.includes('modelType');
  const isProtocolSwitch = Array.isArray(changedKeys) && changedKeys.includes('modelProtocol');
  if (modelType === 'IMAGE_GENERATION') {
    return JSON.stringify(
      buildDebugPayload({
        ...formValues,
        prevHeaders: !isTypeSwitch && !syncFormParameters ? prevObj?.headers : undefined,
      }).input,
      null,
      2
    );
  }

  if (modelType === 'LLM') {
    const protocol = `${formValues?.modelProtocol ?? 'OpenAI'}`.trim().toLowerCase();
    const isResponses = protocol === 'openai responses';
    const apiEndpoint = `${formValues?.apiEndpoint ?? ''}`.trim();
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
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
      prevHeaders: syncFormParameters ? undefined : prevObj?.headers,
    });
    if (protocol === 'anthropic') {
      // 官方 Messages API 还需要版本头；显式自定义版本仍优先，认证沿用既有 Bearer/Header 逻辑。
      const hasVersion = Object.keys(headersObj).some((key) => key.toLowerCase() === 'anthropic-version');
      if (!hasVersion) headersObj['anthropic-version'] = '2023-06-01';
    }
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultMessages = [{ role: 'user', content: defaultUserMessage ?? "How's the weather today?" }];
    const messages =
      !isTypeSwitch && isResponses && (typeof prevObj?.input === 'string' || Array.isArray(prevObj?.input))
        ? prevObj.input
        : !isTypeSwitch && Array.isArray(prevObj?.messages) && prevObj.messages.length
        ? prevObj.messages
        : prevText && `${prevText}`.trim() && !prevObj
        ? [{ role: 'user', content: `${prevText}` }]
        : defaultMessages;

    const temperature = syncFormParameters
      ? formValues?.temperature
      : !isTypeSwitch && typeof prevObj?.temperature === 'number'
      ? prevObj.temperature
      : isResponses
      ? undefined
      : 0.1;
    const stream = !isTypeSwitch && typeof prevObj?.stream === 'boolean' ? prevObj.stream : true;
    // 调试请求 max_tokens 跟左侧高级参数「Max Tokens」对齐：填多少就同步多少。
    const maxTokensChanged = Array.isArray(changedKeys) && changedKeys.includes('maxTokens');
    const formMaxTokens = Number(formValues?.maxTokens);
    const outputTokenKey = isResponses ? 'max_output_tokens' : 'max_tokens';
    const previousMaxTokens = prevObj?.[outputTokenKey];
    let maxTokens: number | undefined;
    if (
      !syncFormParameters &&
      !isTypeSwitch &&
      !maxTokensChanged &&
      typeof previousMaxTokens === 'number' &&
      Number.isFinite(previousMaxTokens) &&
      previousMaxTokens > 0
    ) {
      maxTokens = Math.floor(previousMaxTokens);
    } else if (Number.isFinite(formMaxTokens) && formMaxTokens > 0) {
      maxTokens = Math.floor(formMaxTokens);
    }

    const req: Record<string, any> = {
      url,
      headers: Object.keys(headersObj).length ? headersObj : {},
      model: modelNoOrCode,
      ...(maxTokens !== undefined ? { [outputTokenKey]: maxTokens } : {}),
      [isResponses ? 'input' : 'messages']: messages,
      ...(temperature !== undefined && temperature !== null ? { temperature } : {}),
      stream,
    };
    if (syncFormParameters) {
      // 新增表单的自动请求使用同一份配置；留空的采样参数交给上游默认策略。
      [
        ['topP', 'top_p'],
        ['frequencyPenalty', 'frequency_penalty'],
        ['presencePenalty', 'presence_penalty'],
      ].forEach(([field, param]) => {
        if (typeof formValues?.[field] === 'number' && (!isResponses || field === 'topP'))
          req[param] = formValues[field];
      });
    }
    if (isResponses) {
      // Responses 的思考参数放入 reasoning，不发送 Chat Completions 的开关或扁平 effort。
      const reasoning = buildReasoningConfigPayload(formValues);
      if (reasoning.enabled) {
        req.reasoning = { effort: reasoning.effortMap?.[reasoning.defaultLevel] || reasoning.defaultLevel };
      }
    } else if (syncFormParameters) {
      const reasoning = formValues?.reasoningConfig;
      if (reasoning?.compatFormat === 'deepseek' && formValues?.modelProtocol === 'OpenAI') {
        req.thinking = { type: reasoning.enabled ? 'enabled' : 'disabled' };
        if (reasoning.enabled) {
          applyReasoningDebugParams(req, formValues);
          // 新模板声明支持的程度直接使用；历史配置仍沿用原来的兼容映射。
          const effortMap = safeParseReasoningEffortMap(formValues?.reasoningEffortMapText);
          if (!effortMap?.[reasoning.defaultLevel] && reasoning.supportedEfforts?.includes(reasoning.defaultLevel)) {
            req.reasoning_effort = reasoning.defaultLevel;
          }
        }
      } else if (
        formValues?.providerName === 'MINIMAX' &&
        formValues?.modelCode === 'MiniMax-M3' &&
        formValues?.modelProtocol === 'OpenAI'
      ) {
        req.thinking = { type: reasoning?.enabled ? 'adaptive' : 'disabled' };
      } else if (reasoning?.capability && reasoning.capability !== 'unsupported') {
        applyReasoningDebugParams(req, formValues);
      }
    } else {
      applyReasoningDebugParams(req, formValues);
    }
    return JSON.stringify(req, null, 2);
  }

  if (modelType === 'RERANK') {
    const apiEndpointRaw = `${formValues?.apiEndpoint ?? ''}`.trim();
    const apiEndpoint = normalizeRerankBase(apiEndpointRaw);
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/rerank';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (
      !isTypeSwitch &&
      !isProtocolSwitch &&
      endpointNotShortened &&
      prevUrl &&
      apiEndpoint &&
      prevUrl.startsWith(apiEndpoint)
    ) {
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
    const defaultQuery = defaultRerankQuery ?? 'Beijing travel guide';
    const defaultDocs =
      defaultRerankDocs && defaultRerankDocs.length >= 4
        ? defaultRerankDocs
        : [
            { text: 'Beijing food recommendation', metadata: { id: 0 }, score: 0 },
            { text: 'Tianjin travel guide', metadata: { id: 1 }, score: 0 },
            { text: 'Beginner dev tutorial', metadata: { id: 2 }, score: 0 },
            { text: 'Forbidden City travel guide', metadata: { id: 3 }, score: 0 },
          ];

    const query =
      !isTypeSwitch && typeof prevObj?.query === 'string' && prevObj.query.trim() ? prevObj.query : defaultQuery;
    const docs = !isTypeSwitch && Array.isArray(prevObj?.docs) && prevObj.docs.length ? prevObj.docs : defaultDocs;

    if (formValues?.providerName === 'Bailian' && formValues?.modelProtocol === 'Qwen') {
      // 百炼原生重排与历史 docs/X-Api-Key 协议分开生成，避免把 UI 文档元数据传给上游。
      const previousInput = !isTypeSwitch && prevObj?.input;
      return JSON.stringify(
        {
          url: apiEndpointRaw,
          headers: buildLlmHeaders({
            formApiToken: formValues?.apiToken,
            formHeaders: formValues?.headers,
            prevHeaders: !isTypeSwitch && !syncFormParameters ? prevObj?.headers : undefined,
          }),
          model: modelNoOrCode,
          input: {
            query:
              previousInput?.query &&
              (typeof previousInput.query === 'string' || typeof previousInput.query === 'object')
                ? previousInput.query
                : query,
            documents: Array.isArray(previousInput?.documents)
              ? previousInput.documents
              : docs.map((doc: any) => (typeof doc === 'string' ? doc : doc.text)),
          },
          ...(!isTypeSwitch && prevObj?.parameters ? { parameters: prevObj.parameters } : {}),
        },
        null,
        2
      );
    }

    if (formValues?.providerName === 'SiliconFlow' && formValues?.modelProtocol === 'OpenAI') {
      // 硅基流动采用 Bearer 和 documents，不能继承历史重排模板的 docs/X-Api-Key。
      return JSON.stringify(
        {
          url,
          headers: buildLlmHeaders({
            formApiToken: formValues.apiToken,
            formHeaders: formValues.headers,
            prevHeaders: !isTypeSwitch && !syncFormParameters ? prevObj?.headers : undefined,
          }),
          model: modelNoOrCode,
          query,
          documents:
            !isTypeSwitch && Array.isArray(prevObj?.documents)
              ? prevObj.documents
              : docs.map((doc: any) => (typeof doc === 'string' ? doc : doc.text)),
          ...(!isTypeSwitch && typeof prevObj?.top_n === 'number' ? { top_n: prevObj.top_n } : {}),
          ...(!isTypeSwitch && typeof prevObj?.return_documents === 'boolean'
            ? { return_documents: prevObj.return_documents }
            : {}),
        },
        null,
        2
      );
    }

    const req: Record<string, any> = {
      url,
      headers: Object.keys(headersObj).length ? headersObj : {},
      model: modelNoOrCode,
      query,
      docs,
    };

    if (!isTypeSwitch && !isProtocolSwitch && prevObj) {
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
    const isBailianMultimodal = formValues?.providerName === 'Bailian' && formValues?.modelProtocol === 'Qwen';
    const isArkMultimodal =
      formValues?.providerName === 'Volcengine' && formValues?.modelProtocol === 'Volcengine Multimodal';
    if (isBailianMultimodal || isArkMultimodal) {
      // 原生多模态地址已经包含完整路径，切换协议时不追加 /embeddings，也不复用旧结构。
      const previousInput = !isTypeSwitch && !isProtocolSwitch ? prevObj?.input : undefined;
      const text = typeof previousInput === 'string' ? previousInput : defaultUserMessage ?? "How's the weather today?";
      const input = isBailianMultimodal
        ? { contents: Array.isArray(previousInput?.contents) ? previousInput.contents : [{ text }] }
        : Array.isArray(previousInput)
        ? previousInput
        : [{ type: 'text', text }];
      return JSON.stringify(
        {
          url: apiEndpoint,
          headers: buildLlmHeaders({ formApiToken: formValues.apiToken, formHeaders: formValues.headers }),
          model: formValues.modelCode,
          input,
          ...(isArkMultimodal ? { encoding_format: 'float' } : {}),
          ...(!isTypeSwitch && !isProtocolSwitch && prevObj?.parameters ? { parameters: prevObj.parameters } : {}),
        },
        null,
        2
      );
    }
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/embeddings';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (
      !isTypeSwitch &&
      !isProtocolSwitch &&
      endpointNotShortened &&
      prevUrl &&
      apiEndpoint &&
      prevUrl.startsWith(apiEndpoint)
    ) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildLlmHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultInput = defaultUserMessage ?? "How's the weather today?";
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

export function getModelDebugDispatchTimeoutMs(modelType: any) {
  return normalizeModelType(modelType) === 'IMAGE_GENERATION' ? 130000 : 15000;
}

export function dispatchModelActionWithResult(
  dispatch: (action: any) => void,
  actionType: string,
  payload: any,
  timeoutMs = 15000
) {
  return new Promise<any>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('dispatch timeout'));
    }, timeoutMs);

    const resolveOnce = (res: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(res);
    };

    const rejectOnce = (err: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(err);
    };

    dispatch({
      type: actionType,
      payload,
      success: resolveOnce,
      fail: rejectOnce,
    });
  });
}
