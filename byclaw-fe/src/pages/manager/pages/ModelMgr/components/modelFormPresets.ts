import { cloneDeep, isEqual } from 'lodash';
import { IMAGE_GENERATION_PROVIDERS } from './imageGenerationProviders';
import { DEFAULT_REASONING_CONFIG, getDefaultFormValues } from './modelFormUtils';
import { SEEDREAM_MODEL_PRESETS } from './volcengineImageConfig';

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
    models: ['gemini-3.1-flash-image-preview'],
    source: 'https://ai.google.dev/gemini-api/docs/image-generation',
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
// 未公布独立输出上限的型号不设置 maxTokens，不能把示例值或上下文长度当作输出上限。
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://api-docs.deepseek.com/api/list-models/
const MODEL_PRESET_DEFINITIONS: ModelFormPreset[] = [
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
  ...[
    {
      modelCode: 'qwen3.6-plus',
      label: 'Qwen3.6-Plus',
      developer: 'alibaba',
      contextTokens: 1000000,
      maxTokens: 65536,
      page: 'qwen3-6-plus',
    },
    {
      modelCode: 'qwen3.7-max',
      label: 'Qwen3.7-Max',
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
  {
    id: 'anthropic:claude-sonnet-5',
    label: 'claude-sonnet-5',
    developer: 'anthropic',
    source: 'https://platform.claude.com/docs/en/models/sonnet-5/overview',
    limits: { contextTokens: 1000000, maxTokens: 128000 },
    values: {
      modelCode: 'claude-sonnet-5',
      modelType: 'LLM',
      providerName: 'Anthropic',
      modelProtocol: 'Anthropic',
      apiEndpoint: 'https://api.anthropic.com',
      // Sonnet 5 不接收非默认采样值或手动 thinking budget，使用自适应思考。
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        enabled: true,
        capability: 'adaptive',
        compatFormat: 'anthropic',
        defaultLevel: 'adaptive',
      },
    },
  },
  {
    id: 'bailian:text-embedding-v4',
    label: 'text-embedding-v4',
    developer: 'alibaba',
    channel: 'bailian',
    source: 'https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api',
    limits: { contextTokens: 8192 },
    values: {
      modelCode: 'text-embedding-v4',
      modelType: 'EMBEDDING',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      // 向量维度沿用服务端默认值，不继承任何环境知识库的自定义维度。
    },
  },
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

// 容量只维护一份，自动填充值与校验上限同步；图片模板不附加文本 token 参数。
export const MODEL_FORM_PRESETS: ModelFormPreset[] = MODEL_PRESET_DEFINITIONS.map((preset) => ({
  ...preset,
  values: { ...preset.values, ...preset.limits },
}));

export function getNewModelFormValues() {
  return {
    ...getDefaultFormValues(),
    // 数字员工的公共问答模型按标签 3 筛选；仅新增时默认选中“对话模型”，编辑仍回显已保存配置。
    abilities: ['3'],
    // 未识别模型时不宣称容量或强制传采样值；超时/重试继续使用原有连接策略。
    contextTokens: undefined,
    maxTokens: undefined,
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

/** 同厂商的型号连续排列，厂商内按型号自然排序；仍返回平铺选项，不改变模板 ID 或调用配置。 */
export function getPresetOptions(
  presets = MODEL_FORM_PRESETS,
  locale = 'zh-CN',
  formatLabel: (preset: ModelFormPreset) => string = (preset) => preset.label,
  formatDeveloper: (preset: ModelFormPreset) => string = (preset) => preset.developer || ''
) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return (
    presets
      // 使用模型厂商，而非接入渠道，避免百炼下的 GLM、Kimi 混为同一家；缺少厂商时沿用型号排序。
      .map((preset) => ({ preset, developerLabel: formatDeveloper(preset) || preset.label }))
      .sort(
        (left, right) =>
          collator.compare(left.developerLabel, right.developerLabel) ||
          collator.compare(left.preset.label, right.preset.label)
      )
      .map(({ preset }) => ({ value: preset.id, label: formatLabel(preset) }))
  );
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
