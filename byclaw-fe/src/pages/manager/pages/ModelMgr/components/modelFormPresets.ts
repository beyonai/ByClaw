import { cloneDeep, isEqual } from 'lodash';
import { IMAGE_GENERATION_PROVIDERS } from './imageGenerationProviders';
import { DEFAULT_REASONING_CONFIG, getDefaultFormValues } from './modelFormUtils';
import { SEEDREAM_MODEL_PRESETS } from './volcengineImageConfig';

type Values = Record<string, any>;
export type ModelFormPreset = {
  id: string;
  label: string;
  source: string;
  values: Values;
  limits?: { contextTokens?: number; maxTokens?: number };
};

// 仅登记明确型号；容量来自 2026-10-14 核对的官方文档，maxTokens=8192 是本系统建议输出预算，不是模型上限。
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://api-docs.deepseek.com/api/list-models/
export const MODEL_FORM_PRESETS: ModelFormPreset[] = [
  {
    id: 'minimax:MiniMax-M3',
    label: 'MiniMax · MiniMax-M3',
    source: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
    limits: { contextTokens: 1000000 },
    values: {
      modelCode: 'MiniMax-M3',
      modelType: 'LLM',
      providerName: 'MINIMAX',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.minimax.io/v1',
      contextTokens: 1000000,
      maxTokens: 8192,
      temperature: 1,
      topP: 0.95,
      reasoningConfig: { ...DEFAULT_REASONING_CONFIG, capability: 'adaptive' },
    },
  },
  ...['deepseek-flash', 'deepseek-v4-pro'].map((modelCode) => ({
    id: `deepseek:${modelCode}`,
    label: `DeepSeek · ${modelCode}`,
    source: 'https://api-docs.deepseek.com/api/list-models/',
    limits: { contextTokens: 1048576, maxTokens: 393216 },
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'DeepSeek',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://api.deepseek.com',
      contextTokens: 1048576,
      maxTokens: 8192,
      reasoningConfig: {
        ...DEFAULT_REASONING_CONFIG,
        capability: 'effort',
        compatFormat: 'deepseek',
        supportedEfforts: ['low', 'high', 'max'],
      },
    },
  })),
  // 复用已支持的图片提供商预设，不从型号前缀猜协议，不给自定义 ep ID 套其他型号的能力。
  ...IMAGE_GENERATION_PROVIDERS.filter((provider) => provider.modelCode && provider.apiEndpoint).flatMap((provider) =>
    (provider.providerName === 'VOLCENGINE' ? SEEDREAM_MODEL_PRESETS : [provider.modelCode]).map((modelCode) => ({
      id: `${provider.providerName}:${modelCode}`,
      label: `${provider.label} · ${modelCode}`,
      source: provider.providerName === 'VOLCENGINE' ? 'https://docs.volcengine.com/docs/ark/image-generation-api' : '',
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

export function getNewModelFormValues() {
  return {
    ...getDefaultFormValues(),
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

export function findModelFormPreset(modelCode?: string, presetId?: string) {
  const code = modelCode?.trim().toLowerCase();
  const matches = MODEL_FORM_PRESETS.filter((preset) => preset.values.modelCode.toLowerCase() === code);
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
];

/** 仅用于尚未保存的新增表单；用户主动修改（包括清空）的字段永远优先于自动建议。 */
export function applyModelAutofill(state: ModelAutofillState, changed: Values, values: Values, presetId?: string) {
  Object.keys(changed).forEach((key) => state.edited.add(key));
  if (presetId) state.presetId = presetId;
  const preset = findModelFormPreset(values.modelCode, state.presetId);
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

/** 同协议不同渠道的模板不会仅凭相同型号被选中，必须由用户明确选择。 */
export function getPresetOptions() {
  return MODEL_FORM_PRESETS.map(({ id, label }) => ({ value: id, label }));
}

/** 官方渠道的限额只用于当前新增配置；代理、自定义协议和旧记录继续由其实际服务决定。 */
export function getModelPresetLimits(values: Values, presetId?: string) {
  const preset = findModelFormPreset(values.modelCode, presetId);
  if (!preset || preset.values.modelType !== values.modelType || preset.values.modelProtocol !== values.modelProtocol)
    return undefined;
  const endpoint = `${values.apiEndpoint || ''}`.trim().replace(/\/+$/, '');
  if (endpoint !== preset?.values.apiEndpoint?.replace(/\/+$/, '')) return undefined;
  return preset.limits;
}
