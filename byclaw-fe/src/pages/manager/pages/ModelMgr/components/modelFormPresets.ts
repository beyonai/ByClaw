import { cloneDeep, isEqual } from 'lodash';
import { IMAGE_GENERATION_PROVIDERS } from './imageGenerationProviders';
import {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REASONING_CONFIG,
  getDefaultFormValues,
  getDefaultMaxTokens,
} from './modelFormUtils';
import { SEEDREAM_MODEL_PRESETS } from './volcengineImageConfig';
import { DOMESTIC_MODEL_PRESETS } from './domesticModelPresets';

type Values = Record<string, any>;
export type ModelFormPreset = {
  id: string;
  label: string;
  // 厂商和接入渠道只用于展示；实际调用仍由 values 中的提供商、协议和地址决定。
  developer?: string;
  channel?: string;
  source: string;
  noticeId?: string;
  values: Values;
  limits?: { contextTokens?: number; maxTokens?: number };
};

// 快速配置只使用经核对的公开型号，不从数据库记录、展示名称或提供商注册表自动扩充。
// 接入协议注册表仍完整保留；工作流、代理网关及私有别名可继续手动配置。
const OFFICIAL_IMAGE_TEMPLATES: Record<
  string,
  { models: readonly string[]; source: string; developer: string; channel?: string }
> = {
  GOOGLE: {
    developer: 'google',
    models: [
      'gemini-3.1-flash-image-preview',
      'gemini-nano-banana-2.1',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image',
    ],
    source: 'https://ai.google.dev/gemini-api/docs/generate-content/image-generation',
  },
  MINIMAX: {
    developer: 'minimax',
    models: ['image-01'],
    source: 'https://platform.minimax.io/docs/api-reference/image-generation-t2i',
  },
  OPENAI: {
    developer: 'openai',
    models: ['gpt-image-2'],
    source: 'https://developers.openai.com/api/docs/models/gpt-image-2',
  },
  XAI: {
    developer: 'xai',
    models: ['grok-imagine-image-2.0'],
    source: 'https://docs.x.ai/developers/model-capabilities/images/generation',
  },
  VOLCENGINE: {
    developer: 'bytedance',
    channel: 'volcengine',
    models: SEEDREAM_MODEL_PRESETS,
    source: 'https://docs.volcengine.com/docs/ark/image-generation-api',
  },
};

// 仅登记明确型号；limits 保存 2026-10-15 核对的官方渠道上限，统一用于新建填充和校验。
// 未公布独立输出上限的型号不设置 limits.maxTokens，系统默认预算只写入 values。
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://api-docs.deepseek.com/api/list-models/
const MODEL_PRESET_DEFINITIONS: ModelFormPreset[] = [
  ...DOMESTIC_MODEL_PRESETS,
  ...['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'].map((modelCode) => ({
    id: `openai:${modelCode}`,
    label: modelCode,
    developer: 'openai',
    source: `https://developers.openai.com/api/docs/models/${modelCode}`,
    limits: { contextTokens: 1050000, maxTokens: 128000 },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'OpenAI',
      // GPT-6 的工具调用使用 Responses；不把仅支持纯文本的 Chat Completions 作为默认入口。
      modelProtocol: 'OpenAI Responses',
      apiEndpoint: 'https://api.openai.com/v1',
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'effort',
        compatFormat: 'openai',
        defaultLevel: 'medium',
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      reasoningEffortMapText: JSON.stringify({
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      }),
    },
  })),
  ...[
    { modelCode: 'gemini-4-argon', defaultLevel: 'medium', supportsMinimal: false },
    { modelCode: 'gemini-3.8-flash', defaultLevel: 'medium', supportsMinimal: false },
    { modelCode: 'gemini-3.6-flash', defaultLevel: 'medium', supportsMinimal: true },
    { modelCode: 'gemini-3.5-flash-lite', defaultLevel: 'minimal', supportsMinimal: true },
    { modelCode: 'gemini-3.1-flash-lite', defaultLevel: 'minimal', supportsMinimal: true },
  ].map(({ modelCode, defaultLevel, supportsMinimal }) => ({
    id: `google:${modelCode}`,
    label: modelCode,
    developer: 'google',
    source: `https://ai.google.dev/gemini-api/docs/models/${modelCode}`,
    // Argon 的长输出需额外接口配置，此处登记普通同步请求的输出上限。
    limits: { contextTokens: 1048576, maxTokens: 65536 },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'Google',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'effort',
        compatFormat: 'openai',
        defaultLevel,
        supportedEfforts: [...(supportsMinimal ? ['minimal'] : []), 'low', 'medium', 'high'],
      },
      // Gemini 兼容接口接收原始程度，不能使用旧配置中 low -> high 的兼容映射。
      reasoningEffortMapText: JSON.stringify({
        ...(supportsMinimal ? { minimal: 'minimal' } : {}),
        low: 'low',
        medium: 'medium',
        high: 'high',
      }),
    },
  })),
  {
    id: 'minimax:MiniMax-M3',
    label: 'MiniMax-M3',
    developer: 'minimax',
    source: 'https://platform.minimax.io/docs/api-reference/text-chat-openai',
    limits: { contextTokens: 1000000, maxTokens: 524288 },
    values: {
      modelCode: 'MiniMax-M3',
      modelType: 'LLM',
      providerName: 'MINIMAX',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.minimax.io/v1',
      temperature: 1,
      topP: 0.95,
      reasoningConfig: { ...DEFAULT_REASONING_CONFIG, capability: 'adaptive' },
    },
  },
  ...['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'].map((modelCode) => ({
    id: `minimax:${modelCode}`,
    label: modelCode,
    developer: 'minimax',
    source: 'https://platform.minimax.io/docs/api-reference/text-chat-openai',
    limits: { contextTokens: 204800, maxTokens: 204800 },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'MINIMAX',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.minimax.io/v1',
      temperature: 1,
      topP: 0.9,
      // M2.x 不支持关闭思考，沿用服务端默认行为，不生成思考开关参数。
    },
  })),
  ...['deepseek-flash', 'deepseek-v4-pro'].map((modelCode) => ({
    id: `deepseek:${modelCode}`,
    // 展示市场名称，同时保留实际请求 ID，避免把产品版本名直接发给接口。
    label: modelCode === 'deepseek-flash' ? 'DeepSeek-V4.1-Flash (deepseek-flash)' : 'DeepSeek-V4-Pro',
    developer: 'deepseek',
    source: 'https://api-docs.deepseek.com/api/list-models/',
    limits: { contextTokens: 1048576, maxTokens: 393216 },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'DeepSeek',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.deepseek.com',
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        capability: 'effort',
        compatFormat: 'deepseek',
        supportedEfforts: ['low', 'high', 'max'],
      },
    },
  })),
  // 百炼公开模型使用同一兼容协议；保留渠道说明，不能将本地用户的命名或能力值当作官方参数。
  // 千问展示名统一使用百炼文档登记的 API 型号，文本、向量和重排不混用市场名与接口名。
  ...[
    ...['plus', 'flash'].map((variant) => ({
      modelCode: `qwen3.7-${variant}`,
      label: `qwen3.7-${variant}`,
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 131072,
      page: `qwen3-7-${variant}`,
    })),
    {
      modelCode: 'qwen3.8-max',
      label: 'qwen3.8-max',
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 131072,
      page: 'qwen3-8-max',
    },
    {
      modelCode: 'qwen3.8-flash',
      label: 'qwen3.8-flash',
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 131072,
      page: 'qwen3-8-flash',
    },
    {
      modelCode: 'qwen3.6-plus',
      label: 'qwen3.6-plus',
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 65536,
      page: 'qwen3-6-plus',
    },
    {
      modelCode: 'qwen3.7-max',
      label: 'qwen3.7-max',
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 131072,
      page: 'qwen3-7-max',
    },
    {
      modelCode: 'glm-5.2',
      label: 'GLM-5.2',
      developer: 'zhipu',
      contextTokens: 1048576,
      maxTokens: 131072,
      page: 'glm-5-2',
    },
    {
      modelCode: 'glm-5.1',
      label: 'GLM-5.1',
      developer: 'zhipu',
      contextTokens: 202745,
      maxTokens: 131072,
      page: 'glm-5-1',
    },
    {
      modelCode: 'kimi-k2.6',
      label: 'Kimi-K2.6',
      developer: 'moonshot',
      contextTokens: 262144,
      maxTokens: 16384,
      page: 'kimi-k2-6',
    },
  ].map(({ modelCode, label, developer, contextTokens, maxTokens, page }) => ({
    id: `bailian:${modelCode}`,
    label,
    developer,
    channel: 'bailian',
    source: `https://help.aliyun.com/zh/model-studio/${page}`,
    limits: { contextTokens, maxTokens },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      // 官方保留的北京公共地址；用户可手动换成所属地域/工作区地址。
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      reasoningConfig: { ...DEFAULT_REASONING_CONFIG, capability: 'budget', compatFormat: 'bailian' },
    },
  })),
  // 这些型号默认开启思考；不复用旧模板的 off/budget 默认值，避免新建调试发送不支持的参数。
  ...[
    { modelCode: 'glm-5.3', label: 'GLM-5.3', developer: 'zhipu', page: 'glm-5-3', maxTokens: 131072 },
    {
      modelCode: 'ZHIPU/GLM-5.3-Flash',
      label: 'GLM-5.3-Flash',
      developer: 'zhipu',
      page: 'glm-5-3-flash-by-zhipu',
      maxTokens: 131072,
    },
    { modelCode: 'kimi-k3', label: 'Kimi-K3', developer: 'moonshot', page: 'kimi-k3', maxTokens: 1048576 },
  ].map(({ modelCode, label, developer, page, maxTokens }) => ({
    id: `bailian:${modelCode}`,
    label,
    developer,
    channel: 'bailian',
    source: `https://help.aliyun.com/zh/model-studio/${page}`,
    noticeId: modelCode === 'kimi-k3' ? undefined : 'modelMgr.modal.presetThinkingRequiredHint',
    limits: { contextTokens: 1048576, maxTokens },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'effort',
        compatFormat: 'bailian',
        defaultLevel: 'max',
        supportedEfforts: ['low', 'high', 'max'],
      },
    },
  })),
  {
    id: 'bailian:kimi-k2.7-code',
    label: 'Kimi-K2.7-Code',
    developer: 'moonshot',
    channel: 'bailian',
    source: 'https://help.aliyun.com/zh/model-studio/kimi-k2-7-code',
    noticeId: 'modelMgr.modal.presetThinkingRequiredHint',
    limits: { contextTokens: 262144, maxTokens: 16384 },
    values: {
      modelCode: 'kimi-k2.7-code',
      modelType: 'LLM',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      // 只发送开启思考，不套用 K3 的 effort 或其他模型的思考预算与采样参数。
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'binary',
        compatFormat: 'bailian',
        defaultLevel: 'high',
        supportedEfforts: ['high'],
      },
    },
  },
  {
    id: 'kimi-code:kimi-for-coding',
    // 同一 K2.8 Preview 版本只保留 Kimi 官方入口，不再重复登记 TokenHub 渠道。
    label: 'Kimi-K2.8-Preview (kimi-for-coding)',
    developer: 'moonshot',
    channel: 'kimiCode',
    source: 'https://www.kimi.com/code/docs/kimi-code/models.html',
    noticeId: 'modelMgr.modal.kimiCodePresetHint',
    limits: { contextTokens: 1048576 },
    values: {
      // K2.8 Preview 属于订阅编程入口，不能把产品名称当成开放平台的 model ID。
      modelCode: 'kimi-for-coding',
      modelType: 'LLM',
      providerName: 'Moonshot',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.kimi.com/coding/v1',
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'effort',
        compatFormat: 'openai',
        defaultLevel: 'max',
        supportedEfforts: ['low', 'high', 'max'],
      },
      // 显式映射让新模板的 low 原样传递，保留旧模型既有的兼容映射规则。
      reasoningEffortMapText: JSON.stringify({ low: 'low', high: 'high', max: 'max' }),
    },
  },
  ...['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-5'].map(
    (modelCode) => ({
      id: `anthropic:${modelCode}`,
      label: modelCode,
      developer: 'anthropic',
      source: 'https://platform.claude.com/docs/en/models/overview',
      limits: { contextTokens: 1000000, maxTokens: 128000 },
      values: {
        modelCode,
        modelType: 'LLM',
        providerName: 'Anthropic',
        modelProtocol: 'Anthropic',
        apiEndpoint: 'https://api.anthropic.com',
        // 新一代 Claude 使用自适应思考，不继承其他厂商的采样值或手动思考预算。
        reasoningConfig: {
          ...DEFAULT_REASONING_CONFIG,
          enabled: true,
          capability: 'adaptive',
          compatFormat: 'anthropic',
          defaultLevel: 'adaptive',
        },
      },
    })
  ),
  ...[
    { modelCode: 'text-embedding-v4', contextTokens: 8192 },
    { modelCode: 'qwen3.7-text-embedding', contextTokens: 128000 },
    { modelCode: 'qwen3.7-text-embedding-flash', contextTokens: 128000 },
  ].map(({ modelCode, contextTokens }) => ({
    id: `bailian:${modelCode}`,
    label: modelCode,
    developer: 'alibaba',
    channel: 'bailian',
    source: 'https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api',
    // 使用同步 API 文档的单条输入限制，而非模型介绍页的理论上下文。
    limits: { contextTokens },
    values: {
      modelCode,
      modelType: 'EMBEDDING',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      // 向量维度沿用服务端默认值，不继承任何环境知识库的自定义维度。
    },
  })),
  ...['text-embedding-3-small', 'text-embedding-3-large'].map((modelCode) => ({
    id: `openai:${modelCode}`,
    label: modelCode,
    developer: 'openai',
    source: 'https://developers.openai.com/api/docs/guides/embeddings',
    limits: { contextTokens: 8192 },
    values: {
      modelCode,
      modelType: 'EMBEDDING',
      providerName: 'OpenAI',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.openai.com/v1',
    },
  })),
  {
    id: 'google:gemini-embedding-001',
    label: 'gemini-embedding-001',
    developer: 'google',
    source: 'https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001',
    limits: { contextTokens: 2048 },
    values: {
      modelCode: 'gemini-embedding-001',
      modelType: 'EMBEDDING',
      providerName: 'Google',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
  },
  ...[
    { modelCode: 'qwen3.7-text-rerank', contextTokens: 30000 },
    { modelCode: 'gte-rerank-v2', contextTokens: 30000 },
    { modelCode: 'qwen3-rerank', contextTokens: 4000 },
    { modelCode: 'qwen3-vl-rerank', contextTokens: 8000 },
  ].map(({ modelCode, contextTokens }) => ({
    id: `bailian:${modelCode}`,
    label: modelCode,
    developer: 'alibaba',
    channel: 'bailian',
    source: 'https://help.aliyun.com/zh/model-studio/text-rerank-api',
    limits: { contextTokens },
    values: {
      modelCode,
      modelType: 'RERANK',
      providerName: 'Bailian',
      modelProtocol: 'Qwen',
      // DashScope 重排使用完整服务地址和嵌套 input；不能拼接通用 /rerank。
      apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
    },
  })),
  // 仅复用已支持的协议与连接地址，候选型号由官方目录明确登记。
  ...IMAGE_GENERATION_PROVIDERS.filter((provider) => OFFICIAL_IMAGE_TEMPLATES[provider.providerName]).flatMap(
    (provider) =>
      OFFICIAL_IMAGE_TEMPLATES[provider.providerName].models.map((modelCode) => ({
        id: `${provider.providerName}:${modelCode}`,
        label: modelCode,
        developer: OFFICIAL_IMAGE_TEMPLATES[provider.providerName].developer,
        channel: OFFICIAL_IMAGE_TEMPLATES[provider.providerName].channel,
        source: OFFICIAL_IMAGE_TEMPLATES[provider.providerName].source,
        values: {
          modelType: 'IMAGE_GENERATION',
          providerName: provider.providerName,
          modelProtocol: provider.modelProtocol,
          apiEndpoint: provider.apiEndpoint,
          modelCode,
          prompt: '',
          aspectRatio: '1:1',
          imageCount: 1,
          responseFormat: 'url',
          ...(provider.providerName === 'VOLCENGINE'
            ? { imageGenerationConfig: { size: '2K', responseFormat: 'url', watermark: true } }
            : {}),
        },
      }))
  ),
];

// 官方上限优先；缺失时补前端配置默认值，不写入 limits，图片模板不附加文本容量。
export const MODEL_FORM_PRESETS: ModelFormPreset[] = MODEL_PRESET_DEFINITIONS.map((preset) => ({
  ...preset,
  values: {
    ...preset.values,
    ...(preset.values.modelType === 'LLM' ? { maxTokens: getDefaultMaxTokens(preset.limits?.contextTokens) } : {}),
    ...preset.limits,
    ...(preset.values.modelType !== 'IMAGE_GENERATION'
      ? { contextTokens: preset.limits?.contextTokens ?? DEFAULT_CONTEXT_TOKENS }
      : {}),
  },
}));

export function getNewModelFormValues() {
  return {
    ...getDefaultFormValues(),
    // 数字员工的公共问答模型按标签 3 筛选；仅新增时默认选中“对话模型”，编辑仍回显已保存配置。
    abilities: ['3'],
    // 未识别型号先带入配置默认值；识别模板后以官方上限替换，手动值仍优先。
    contextTokens: DEFAULT_CONTEXT_TOKENS,
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: undefined,
    topP: undefined,
    frequencyPenalty: undefined,
    presencePenalty: undefined,
  };
}

export type ModelAutofillState = {
  automatic: Values;
  edited: Set<string>;
  presetId?: string;
};

export function createModelAutofillState(): ModelAutofillState {
  return { automatic: cloneDeep(getNewModelFormValues()), edited: new Set() };
}

export function findModelFormPreset(modelCode?: string, presetId?: string, presets = MODEL_FORM_PRESETS) {
  const code = modelCode?.trim().toLowerCase();
  const matches = presets.filter((preset) => preset.values.modelCode.toLowerCase() === code);
  return matches.find((preset) => preset.id === presetId) || (matches.length === 1 ? matches[0] : undefined);
}

const CAPABILITY_FIELDS = [
  'contextTokens',
  'maxTokens',
  'temperature',
  'topP',
  'frequencyPenalty',
  'presencePenalty',
  'reasoningConfig',
  'imageGenerationConfig',
  'reasoningEffortMapText',
  'extendParam',
];

/** 仅用于尚未保存的新增表单；用户主动修改（包括清空）的字段永远优先于自动建议。 */
export function applyModelAutofill(
  state: ModelAutofillState,
  changed: Values,
  values: Values,
  presetId?: string,
  presets = MODEL_FORM_PRESETS
) {
  Object.keys(changed).forEach((key) => state.edited.add(key));
  if (presetId) state.presetId = presetId;
  const preset = findModelFormPreset(values.modelCode, state.presetId, presets);
  state.presetId = preset?.id;
  const defaults: Values = getNewModelFormValues();
  const suggestions: Values = {};
  // 切换到未知型号时撤销旧的自动能力值，保留接入信息与手填参数，便于配置代理别名。
  CAPABILITY_FIELDS.forEach((key) => {
    suggestions[key] = defaults[key];
  });
  if (preset && (!state.edited.has('modelType') || values.modelType === preset.values.modelType)) {
    Object.assign(suggestions, preset.values);
  }
  const modelType = suggestions.modelType ?? values.modelType;
  // 图片模型不使用上下文；向量和重排只保留输入容量，不带入文本输出预算。
  if (modelType === 'IMAGE_GENERATION') suggestions.contextTokens = undefined;
  if (modelType !== 'LLM') {
    suggestions.maxTokens = undefined;
  } else if (!preset?.limits?.maxTokens) {
    suggestions.maxTokens = getDefaultMaxTokens(
      state.edited.has('contextTokens') ? values.contextTokens : suggestions.contextTokens
    );
  }
  suggestions.displayName = `${values.modelCode || ''}`.trim().slice(0, 50);
  delete suggestions.modelCode;
  return applyAutofillFields(state, values, suggestions);
}

/** 选择提供商的旧快捷入口也遵守手填值保护，不把整套预设直接覆盖表单。 */
export function applyAutofillFields(state: ModelAutofillState, values: Values, suggestions: Values) {
  const patch: Values = {};
  Object.entries(suggestions).forEach(([key, value]) => {
    if (state.edited.has(key)) return;
    const empty = values[key] === undefined || values[key] === null || values[key] === '';
    if (empty || isEqual(values[key], state.automatic[key])) {
      patch[key] = cloneDeep(value);
      state.automatic[key] = cloneDeep(value);
    }
  });
  return patch;
}

/** 全列表按型号自然排序，厂商与渠道仅作为展示后缀，不改变模板 ID 或调用配置。 */
export function getPresetOptions(
  presets = MODEL_FORM_PRESETS,
  locale = 'zh-CN',
  formatLabel: (preset: ModelFormPreset) => string = (preset) => preset.label
) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  // 拷贝后排序，保持目录定义及同名不同渠道的稳定顺序。
  return [...presets]
    .sort((left, right) => collator.compare(left.label, right.label))
    .map((preset) => ({ value: preset.id, label: formatLabel(preset) }));
}

/** 官方渠道的限额只用于当前新增配置；代理、自定义协议和旧记录继续由其实际服务决定。 */
export function getModelPresetLimits(values: Values, presetId?: string, presets = MODEL_FORM_PRESETS) {
  const preset = findModelFormPreset(values.modelCode, presetId, presets);
  if (!preset || preset.values.modelType !== values.modelType || preset.values.modelProtocol !== values.modelProtocol)
    return undefined;
  const endpoint = `${values.apiEndpoint || ''}`.trim().replace(/\/+$/, '');
  if (endpoint !== preset?.values.apiEndpoint?.replace(/\/+$/, '')) return undefined;
  return preset.limits;
}
