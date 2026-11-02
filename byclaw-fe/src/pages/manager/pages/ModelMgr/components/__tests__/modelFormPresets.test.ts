import type { ModelFormPreset } from '../modelFormPresets';
import {
  applyAutofillFields,
  applyModelAutofill,
  createModelAutofillState,
  findModelFormPreset,
  getModelPresetLimits,
  getNewModelFormValues,
  getPresetOptions,
  MODEL_FORM_PRESETS,
} from '../modelFormPresets';
import { buildAutoDebugRequestText, buildModelUpsertPayload } from '../modelFormUtils';
import { getImageGenerationProvider } from '../imageGenerationProviders';

describe('deterministic model form presets', () => {
  it('registers each model version once across channels and retains official Kimi access', () => {
    // 显示名中的 API 别名后缀不构成新版本；厂商、类型和版本后缀仍参与区分。
    const versionKeys = MODEL_FORM_PRESETS.map((preset) => {
      const version = preset.label
        .replace(/ \([^)]*\)$/, '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
      return `${preset.developer}:${preset.values.modelType}:${version}`;
    });
    expect(new Set(versionKeys).size).toBe(versionKeys.length);
    expect(MODEL_FORM_PRESETS.some((preset) => preset.id === 'tokenhub:kimi-k2.8-preview')).toBe(false);
    expect(findModelFormPreset('kimi-for-coding')).toMatchObject({
      id: 'kimi-code:kimi-for-coding',
      values: { providerName: 'Moonshot', apiEndpoint: 'https://api.kimi.com/coding/v1' },
    });
    // 高速版、Flash/FlashX 和 Pro 属于独立规格，不能因共同前缀被合并。
    [
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'ZHIPU/GLM-5.3-Flash',
      'glm-5.3-flashx',
      'qwen-image-3.0',
      'qwen-image-3.0-pro',
      'deepseek-v4-pro',
    ].forEach((modelCode) => expect(findModelFormPreset(modelCode)).toBeDefined());
  });

  it('omits replaceable snapshots while retaining date-only model variants and saved model codes', () => {
    expect(findModelFormPreset('deepseek-v4-pro-0813')).toBeUndefined();
    expect(findModelFormPreset('deepseek-v4-pro')?.id).toBe('deepseek:deepseek-v4-pro');
    // 不按日期正则批量删除；这些系列/规格在目录中没有等价的非日期入口。
    [
      'deepseek-v4-flash-0731',
      'siliconflow/deepseek-v3-0324',
      'doubao-seed-2-1-pro-260915',
      'doubao-seed-2-1-lite-260915',
      'doubao-seed-2-1-turbo-260628',
      'tongyi-embedding-vision-plus-2026-03-06',
      'tongyi-embedding-vision-flash-2026-03-06',
      'doubao-embedding-vision-251215',
      'doubao-seedream-4-0-250828',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-flash-260915',
    ].forEach((modelCode) => expect(findModelFormPreset(modelCode)?.values.modelCode).toBe(modelCode));
    const savedValues = {
      ...getNewModelFormValues(),
      id: 'saved-snapshot',
      modelCode: 'deepseek-v4-pro-0813',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://workspace-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    };
    expect(buildModelUpsertPayload({ values: savedValues })).toMatchObject({
      id: 'saved-snapshot',
      modelCode: 'deepseek-v4-pro-0813',
      apiEndpoint: savedValues.apiEndpoint,
    });
  });

  // 独立列出核实过的规格，覆盖模板 -> 表单 -> 保存/调试，防止再统一回落为示例输出预算。
  it.each<[string, number, number]>([
    ['MiniMax-M3', 1000000, 524288],
    ['MiniMax-M2.7', 204800, 204800],
    ['MiniMax-M2.7-highspeed', 204800, 204800],
    ['deepseek-flash', 1048576, 393216],
    ['deepseek-v4-pro', 1048576, 393216],
    ['qwen3.6-plus', 1000000, 65536],
    ['qwen3.7-max', 1000000, 131072],
    ['glm-5.1', 202745, 131072],
    ['glm-5.2', 1048576, 131072],
    ['glm-5.3', 1048576, 131072],
    ['ZHIPU/GLM-5.3-Flash', 1048576, 131072],
    ['kimi-k2.6', 262144, 16384],
    ['kimi-k2.7-code', 262144, 16384],
    ['kimi-k3', 1048576, 1048576],
    ['claude-sonnet-5', 1000000, 128000],
    ['claude-fable-5-1', 1000000, 128000],
    ['claude-opus-5-5', 1000000, 128000],
    ['claude-sonnet-5-5', 1000000, 128000],
    ['claude-haiku-5-5', 1000000, 128000],
    ['qwen3.8-max', 1000000, 131072],
    ['qwen3.8-flash', 1000000, 131072],
    ['gemini-4-argon', 1048576, 65536],
    ['gemini-3.8-flash', 1048576, 65536],
    ['gemini-3.6-flash', 1048576, 65536],
    ['gemini-3.5-flash-lite', 1048576, 65536],
    ['gemini-3.1-flash-lite', 1048576, 65536],
  ])('fills and submits official context/output ceilings for %s', (modelCode, contextTokens, maxTokens) => {
    const state = createModelAutofillState();
    const initial = { ...getNewModelFormValues(), modelCode };
    const presetId = modelCode === 'deepseek-v4-pro' ? 'deepseek:deepseek-v4-pro' : undefined;
    const values = { ...initial, ...applyModelAutofill(state, { modelCode }, initial, presetId) };
    expect(values).toMatchObject({ contextTokens, maxTokens });
    expect(getModelPresetLimits(values, presetId)).toEqual({ contextTokens, maxTokens });
    expect(buildModelUpsertPayload({ values })).toMatchObject({ contextTokens, maxTokens });
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug.max_tokens).toBe(maxTokens);
  });

  it.each(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])(
    'fills %s and generates the Responses contract',
    (modelCode) => {
      const state = createModelAutofillState();
      const initial = { ...getNewModelFormValues(), modelCode, apiToken: 'test-token' };
      const values = { ...initial, ...applyModelAutofill(state, { modelCode }, initial) };
      expect(buildModelUpsertPayload({ values })).toMatchObject({
        modelCode,
        modelProtocol: 'OpenAI Responses',
        contextTokens: 1050000,
        maxTokens: 128000,
        reasoningConfig: { enabled: true, defaultLevel: 'medium', effortMap: { medium: 'medium' } },
      });
      const debug = JSON.parse(
        buildAutoDebugRequestText({ formValues: values, syncFormParameters: true, defaultUserMessage: 'hello' })
      );
      expect(debug).toEqual({
        url: 'https://api.openai.com/v1/responses',
        headers: { Authorization: 'Bearer test-token' },
        model: modelCode,
        max_output_tokens: 128000,
        input: [{ role: 'user', content: 'hello' }],
        stream: true,
        reasoning: { effort: 'medium' },
      });
    }
  );

  it.each<[string, number, string]>([
    ['text-embedding-3-small', 8192, 'https://api.openai.com/v1/embeddings'],
    ['text-embedding-3-large', 8192, 'https://api.openai.com/v1/embeddings'],
    ['qwen3.7-text-embedding', 128000, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'],
    ['qwen3.7-text-embedding-flash', 128000, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'],
    ['gemini-embedding-001', 2048, 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings'],
  ])('clears text generation settings when selecting %s', (modelCode, contextTokens, url) => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'MiniMax-M3', apiToken: 'test-token' };
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    values.modelCode = modelCode;
    values = { ...values, ...applyModelAutofill(state, { modelCode }, values) };
    expect(buildModelUpsertPayload({ values })).toMatchObject({ modelCode, modelType: 'EMBEDDING', contextTokens });
    expect(values.maxTokens).toBeUndefined();
    expect(values.temperature).toBeUndefined();
    expect(
      JSON.parse(
        buildAutoDebugRequestText({ formValues: values, syncFormParameters: true, defaultUserMessage: 'hello' })
      )
    ).toEqual({
      url,
      headers: { Authorization: 'Bearer test-token' },
      model: modelCode,
      input: 'hello',
    });
  });

  it.each(['qwen3.7-text-rerank', 'gte-rerank-v2'])('uses the native Bailian rerank contract for %s', (modelCode) => {
    const values = { ...findModelFormPreset(modelCode)!.values, apiToken: 'test-token' };
    expect(buildModelUpsertPayload({ values })).toMatchObject({
      modelType: 'RERANK',
      modelProtocol: 'Qwen',
      contextTokens: 30000,
    });
    expect(values).not.toHaveProperty('maxTokens');
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank');
    expect(debug.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(debug.input.query).toEqual(expect.any(String));
    expect(debug.input.documents).toHaveLength(4);
    debug.input.documents.forEach((doc: unknown) => expect(typeof doc).toBe('string'));
    ['docs', 'query', 'max_tokens', 'temperature', 'messages'].forEach((key) => expect(debug).not.toHaveProperty(key));
  });

  it.each(['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image'])(
    'registers stable Google image model %s using the supported image adapter',
    (modelCode) => {
      const values = findModelFormPreset(modelCode)!.values;
      expect(values).toMatchObject({
        modelCode,
        modelType: 'IMAGE_GENERATION',
        modelProtocol: 'GOOGLE_IMAGE',
        providerName: 'GOOGLE',
      });
      expect(values).not.toHaveProperty('maxTokens');
      expect(values).not.toHaveProperty('contextTokens');
    }
  );

  it.each(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])(
    'preserves supported Gemini effort levels for %s',
    (modelCode) => {
      const preset = findModelFormPreset(modelCode)!;
      preset.values.reasoningConfig.supportedEfforts.forEach((defaultLevel: string) => {
        const values = { ...preset.values, reasoningConfig: { ...preset.values.reasoningConfig, defaultLevel } };
        const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
        expect(debug.reasoning_effort).toBe(defaultLevel);
        expect(debug).not.toHaveProperty('enable_thinking');
        expect(debug).not.toHaveProperty('chat_template_kwargs');
      });
    }
  );

  it('uses the default budget for Kimi Code without treating it as an official output ceiling', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'deepseek-flash' };
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    const prevText = buildAutoDebugRequestText({ formValues: values, syncFormParameters: true });
    values.modelCode = 'kimi-for-coding';
    values = { ...values, ...applyModelAutofill(state, { modelCode: values.modelCode }, values) };
    expect(values.contextTokens).toBe(1048576);
    expect(values.maxTokens).toBe(65536);
    expect(getModelPresetLimits(values)).toEqual({ contextTokens: 1048576 });
    expect(buildModelUpsertPayload({ values }).maxTokens).toBe(65536);
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true, prevText }));
    expect(debug.max_tokens).toBe(65536);
  });

  it('uses configured defaults for unknown capacities without registering official limits', () => {
    const values = getNewModelFormValues();
    expect(values.contextTokens).toBe(202752);
    expect(getModelPresetLimits(values)).toBeUndefined();
    expect(buildModelUpsertPayload({ values })).toMatchObject({ contextTokens: 202752, maxTokens: 65536 });
    expect(JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true })).max_tokens).toBe(
      65536
    );
  });

  it.each([8192, undefined])('preserves manual context values including clearing: %s', (contextTokens) => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), contextTokens };
    values = { ...values, ...applyModelAutofill(state, { contextTokens }, values) };
    ['sensenova-6.8-flash-lite', 'glm-5.3', 'private-alias'].forEach((modelCode) => {
      values = { ...values, modelCode };
      values = { ...values, ...applyModelAutofill(state, { modelCode }, values) };
      expect(values.contextTokens).toBe(contextTokens);
      expect(buildModelUpsertPayload({ values }).contextTokens).toBe(contextTokens);
    });
  });

  it.each([4096, undefined])('keeps manually entered or cleared capacity across template switches: %s', (maxTokens) => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'MiniMax-M3' };
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    const manual = { contextTokens: 200000, maxTokens };
    values = { ...values, ...manual };
    applyModelAutofill(state, manual, values);
    ['deepseek-flash', 'kimi-for-coding', 'glm-5.3'].forEach((modelCode) => {
      values = { ...values, modelCode };
      values = { ...values, ...applyModelAutofill(state, { modelCode }, values) };
      expect(values).toMatchObject(manual);
      expect(buildModelUpsertPayload({ values })).toMatchObject(manual);
    });
  });

  it('only fills input capacity for embeddings and does not attach text capacities to image templates', () => {
    const embedding = findModelFormPreset('text-embedding-v4')!.values;
    expect(embedding.contextTokens).toBe(8192);
    expect(embedding).not.toHaveProperty('maxTokens');
    MODEL_FORM_PRESETS.filter(({ values }) => values.modelType === 'IMAGE_GENERATION').forEach(({ values }) => {
      expect(values).not.toHaveProperty('contextTokens');
      expect(values).not.toHaveProperty('maxTokens');
    });
  });

  it.each([
    ['GLM-5.3', 'bailian:glm-5.3', 'glm-5.3'],
    ['GLM-5.3-Flash', 'bailian:ZHIPU/GLM-5.3-Flash', 'ZHIPU/GLM-5.3-Flash'],
    ['GLM-5.2', 'bailian:glm-5.2', 'glm-5.2'],
    ['GLM-5.1', 'bailian:glm-5.1', 'glm-5.1'],
    ['MiniMax-M3', 'minimax:MiniMax-M3', 'MiniMax-M3'],
    ['Kimi-K3', 'bailian:kimi-k3', 'kimi-k3'],
    ['Kimi-K2.8-Preview', 'kimi-code:kimi-for-coding', 'kimi-for-coding'],
    ['Kimi-K2.7-Code', 'bailian:kimi-k2.7-code', 'kimi-k2.7-code'],
    ['Kimi-K2.6', 'bailian:kimi-k2.6', 'kimi-k2.6'],
    ['DeepSeek-V4.1-Flash', 'deepseek:deepseek-flash', 'deepseek-flash'],
    ['DeepSeek-V4-Pro', 'deepseek:deepseek-v4-pro', 'deepseek-v4-pro'],
  ])('finds %s by its public name and saves the channel-specific API ID', (name, presetId, modelCode) => {
    expect(
      getPresetOptions()
        .find(({ value }) => value === presetId)
        ?.label.toLowerCase()
    ).toContain(name.toLowerCase());
    const state = createModelAutofillState();
    const values = { ...getNewModelFormValues(), modelCode, apiToken: 'test-token' };
    const filled = { ...values, ...applyModelAutofill(state, { modelCode }, values, presetId) };
    const payload = buildModelUpsertPayload({ values: filled });
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: filled, syncFormParameters: true }));
    expect(payload).toMatchObject({ modelType: 'LLM', modelProtocol: 'OpenAI', modelCode, apiToken: 'test-token' });
    expect(payload.contextTokens).toBeGreaterThan(0);
    expect(debug.model).toBe(modelCode);
    expect(debug.url).toBe(`${filled.apiEndpoint}/chat/completions`);
    expect(payload).not.toHaveProperty('noticeId');
    expect(payload).not.toHaveProperty('source');
    expect(payload).not.toHaveProperty('developer');
    expect(payload).not.toHaveProperty('channel');
  });

  it.each(['glm-5.3', 'ZHIPU/GLM-5.3-Flash', 'kimi-k3'])(
    'enables thinking and uses only supported effort values for %s',
    (modelCode) => {
      const values = findModelFormPreset(modelCode)!.values;
      const defaultDebug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
      expect(defaultDebug).toMatchObject({ enable_thinking: true, reasoning_effort: 'max' });
      ['low', 'high', 'max'].forEach((defaultLevel) => {
        const formValues = { ...values, reasoningConfig: { ...values.reasoningConfig, defaultLevel } };
        const debug = JSON.parse(buildAutoDebugRequestText({ formValues, syncFormParameters: true }));
        expect(debug).toMatchObject({ enable_thinking: true, reasoning_effort: defaultLevel });
        ['thinking_budget', 'chat_template_kwargs', 'temperature', 'top_p'].forEach((key) =>
          expect(debug).not.toHaveProperty(key)
        );
        expect(buildModelUpsertPayload({ values: formValues }).reasoningConfig).toMatchObject({
          enabled: true,
          defaultLevel,
          compatFormat: 'bailian',
          supportedEfforts: ['low', 'high', 'max'],
        });
      });
    }
  );

  it('keeps K2.7 Code thinking on without sending unsupported effort, sampling or budget parameters', () => {
    const values = findModelFormPreset('kimi-k2.7-code')!.values;
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug.enable_thinking).toBe(true);
    ['reasoning_effort', 'thinking_budget', 'temperature', 'top_p'].forEach((key) =>
      expect(debug).not.toHaveProperty(key)
    );
    expect(getModelPresetLimits(values)).toEqual({ contextTokens: 262144, maxTokens: 16384 });
  });

  it('keeps Kimi Code credentials and model ID separate from the open platform and preserves low effort', () => {
    const preset = findModelFormPreset('kimi-for-coding')!;
    expect(preset.values.apiEndpoint).toBe('https://api.kimi.com/coding/v1');
    expect(preset.noticeId).toBe('modelMgr.modal.kimiCodePresetHint');
    expect(findModelFormPreset('kimi-k2.8-preview')).toBeUndefined();
    const values = {
      ...preset.values,
      reasoningConfig: { ...preset.values.reasoningConfig, defaultLevel: 'low' },
    };
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug).toMatchObject({ model: 'kimi-for-coding', reasoning_effort: 'low' });
    expect(debug).not.toHaveProperty('enable_thinking');
    expect(debug).not.toHaveProperty('chat_template_kwargs');
    expect(buildModelUpsertPayload({ values }).reasoningConfig.effortMap).toEqual({
      low: 'low',
      high: 'high',
      max: 'max',
    });
  });

  it('switches to new templates without retaining old automatic sampling or overwriting manual connection fields', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'MiniMax-M3' };
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    const manual = {
      apiEndpoint: 'https://proxy.example/v1',
      modelProtocol: 'Anthropic',
      providerName: 'custom-provider',
      displayName: 'Custom deployment',
      maxTokens: 4096,
      apiToken: 'test-token',
      headers: [{ key: 'X-Project', value: 'custom' }],
    };
    values = { ...values, ...manual, modelCode: 'kimi-for-coding' };
    values = { ...values, ...applyModelAutofill(state, manual, values) };
    expect(values).toMatchObject(manual);
    expect(values.temperature).toBeUndefined();
    expect(values.topP).toBeUndefined();
    expect(getModelPresetLimits(values)).toBeUndefined();
    expect(JSON.parse(values.reasoningEffortMapText)).toEqual({ low: 'low', high: 'high', max: 'max' });
    values.modelCode = 'glm-5.1';
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    expect(values).toMatchObject(manual);
    expect(values.contextTokens).toBe(202745);
    // 文本控件清空为 ''；保存时也不能残留上一模板的 effort 映射。
    expect(values.reasoningEffortMapText).toBe('');
    expect(buildModelUpsertPayload({ values }).reasoningConfig).not.toHaveProperty('effortMap');
    expect(values.reasoningConfig).toMatchObject({ enabled: false, compatFormat: 'bailian' });
    expect(buildModelUpsertPayload({ values }).reasoningConfig).not.toHaveProperty('effortMap');
  });

  it('keeps official templates separate from saved aliases and supported gateway protocols', () => {
    const codes = MODEL_FORM_PRESETS.map((preset) => preset.values.modelCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        'MiniMax-M2.7-highspeed',
        'MiniMax-M3',
        'deepseek-flash',
        'kimi-k2.6',
        'qwen3.6-plus',
        'qwen3.7-max',
        'glm-5.2',
        'claude-sonnet-5',
        'text-embedding-v4',
        'image-01',
        'doubao-seedream-4-0-250828',
        'doubao-seedream-5-0-260128',
      ])
    );
    ['model2', 'tts', 'workflow', 'MiniMax-M2.7-highspeed2', 'deepseek-v4.1-flash:cloud'].forEach((code) => {
      expect(codes).not.toContain(code);
      expect(findModelFormPreset(code)).toBeUndefined();
    });
    expect(new Set(MODEL_FORM_PRESETS.map(({ id }) => id)).size).toBe(MODEL_FORM_PRESETS.length);
    MODEL_FORM_PRESETS.forEach(({ source, values }) => {
      expect(source).toMatch(/^https:\/\//);
      expect(values).not.toHaveProperty('apiToken');
      expect(values).not.toHaveProperty('headers');
      expect(values).not.toHaveProperty('id');
      expect(values.apiEndpoint).not.toMatch(/localhost|127\.0\.0\.1|example\./);
    });
    // 移出模板目录不等于删除协议；已有 ComfyUI、LiteLLM 配置仍使用原来的协议注册项。
    expect(getImageGenerationProvider('COMFYUI')?.modelProtocol).toBe('COMFY_IMAGE');
    expect(getImageGenerationProvider('LITELLM')?.modelProtocol).toBe('LITELLM_IMAGE');
    expect(MODEL_FORM_PRESETS.some(({ values }) => ['COMFYUI', 'LITELLM'].includes(values.providerName))).toBe(false);
  });

  it('fills Bailian capabilities and keeps their wire parameters distinct from other providers', () => {
    const values = findModelFormPreset('qwen3.6-plus')!.values;
    expect(values).toMatchObject({
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      contextTokens: 1000000,
    });
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug.enable_thinking).toBe(false);
    expect(debug).not.toHaveProperty('thinking');
    expect(debug).not.toHaveProperty('chat_template_kwargs');
    expect(getModelPresetLimits(values)?.maxTokens).toBe(65536);
  });

  it('clears automatic sampling for Sonnet and clears generation budgets for embedding templates', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'MiniMax-M3' };
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    values.modelCode = 'claude-sonnet-5';
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    const debug = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(debug).not.toHaveProperty('temperature');
    expect(debug).not.toHaveProperty('top_p');
    expect(debug.thinking).toMatchObject({ type: 'adaptive' });
    expect(debug.thinking).not.toHaveProperty('budget_tokens');
    values.modelCode = 'text-embedding-v4';
    values = { ...values, ...applyModelAutofill(state, {}, values) };
    expect(values).toMatchObject({ modelType: 'EMBEDDING', contextTokens: 8192 });
    expect(values.maxTokens).toBeUndefined();
    expect(values.temperature).toBeUndefined();
  });

  it('falls back to model names when developers are absent without merging variants or reordering the catalog', () => {
    const presets: ModelFormPreset[] = [
      {
        id: 'environment',
        label: 'Zeta',
        source: '',
        values: { modelCode: 'zeta' },
      },
      { id: 'builtin', label: 'Alpha 10', source: '', values: { modelCode: 'alpha-10' } },
      {
        id: 'personal',
        label: 'alpha 2',
        source: '',
        values: { modelCode: 'same-model', modelProtocol: 'OpenAI' },
      },
      {
        id: 'public',
        label: 'Alpha 2',
        source: '',
        values: { modelCode: 'same-model', modelProtocol: 'Anthropic' },
      },
    ];
    expect(getPresetOptions(presets, 'en-US')).toEqual([
      { value: 'personal', label: 'alpha 2' },
      { value: 'public', label: 'Alpha 2' },
      { value: 'builtin', label: 'Alpha 10' },
      { value: 'environment', label: 'Zeta' },
    ]);
    // 渠道后缀不抢占型号的排序优先级，也不会改变选项 ID 对应的调用配置。
    const valuesBefore = JSON.stringify(presets.map(({ values }) => values));
    expect(getPresetOptions(presets, 'en-US', ({ label }) => `${label} · Developer (via Channel)`)).toEqual([
      { value: 'personal', label: 'alpha 2 · Developer (via Channel)' },
      { value: 'public', label: 'Alpha 2 · Developer (via Channel)' },
      { value: 'builtin', label: 'Alpha 10 · Developer (via Channel)' },
      { value: 'environment', label: 'Zeta · Developer (via Channel)' },
    ]);
    expect(JSON.stringify(presets.map(({ values }) => values))).toBe(valuesBefore);
    expect(presets.map(({ id }) => id)).toEqual(['environment', 'builtin', 'personal', 'public']);
    expect(findModelFormPreset('same-model', undefined, presets)).toBeUndefined();
    expect(findModelFormPreset('same-model', 'public', presets)?.values.modelProtocol).toBe('Anthropic');
  });

  it.each(['zh-CN', 'en-US'])('sorts the complete catalog by name across developers and channels: %s', (locale) => {
    const before = JSON.stringify(MODEL_FORM_PRESETS);
    const options = getPresetOptions(MODEL_FORM_PRESETS, locale);
    const ordered = options.map(({ value }) => MODEL_FORM_PRESETS.find(({ id }) => id === value)!);
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    ordered.slice(1).forEach((preset, index) => {
      expect(collator.compare(ordered[index].label, preset.label)).toBeLessThanOrEqual(0);
    });
    expect(options).toHaveLength(MODEL_FORM_PRESETS.length);
    expect(JSON.stringify(MODEL_FORM_PRESETS)).toBe(before);
  });

  it('sorts model versions naturally without prioritizing developer or channel names', () => {
    const presets = [
      { id: 'zhipu-10', label: 'GLM-10', developer: 'zhipu' },
      { id: 'alibaba-10', label: 'Qwen-10', developer: 'alibaba' },
      { id: 'zhipu-2', label: 'GLM-2', developer: 'zhipu' },
      { id: 'bytedance', label: 'Seedream', developer: 'bytedance' },
      { id: 'alibaba-2', label: 'Qwen-2', developer: 'alibaba' },
    ].map((preset) => ({ ...preset, channel: 'bailian', source: '', values: {} }));
    expect(getPresetOptions(presets, 'zh-CN').map(({ value }) => value)).toEqual([
      'zhipu-2',
      'zhipu-10',
      'alibaba-2',
      'alibaba-10',
      'bytedance',
    ]);
  });

  it('sorts Chinese display names by pinyin and retains separate options with identical labels', () => {
    const presets = ['智谱', '阿里云', '豆包', '豆包'].map((label, index) => ({
      id: String(index),
      label,
      source: '',
      values: {},
    }));
    expect(getPresetOptions(presets, 'zh-CN')).toEqual([
      { value: '1', label: '阿里云' },
      { value: '2', label: '豆包' },
      { value: '3', label: '豆包' },
      { value: '0', label: '智谱' },
    ]);
  });

  it('fills a known Seedream version without changing credentials or custom headers', () => {
    const state = createModelAutofillState();
    const values = {
      ...getNewModelFormValues(),
      modelCode: 'doubao-seedream-4-0-250828',
      apiToken: 'test-token',
      headers: [{ key: 'X-Project', value: 'example' }],
    };
    const patch = applyModelAutofill(state, { modelCode: values.modelCode }, values);
    expect(patch).toMatchObject({
      displayName: values.modelCode,
      modelType: 'IMAGE_GENERATION',
      modelProtocol: 'VOLCENGINE_IMAGE',
      providerName: 'VOLCENGINE',
      imageGenerationConfig: { size: '2K', responseFormat: 'url', watermark: true },
    });
    expect(patch).not.toHaveProperty('apiToken');
    expect(patch).not.toHaveProperty('headers');
    const payload = buildModelUpsertPayload({ values: { ...values, ...patch } });
    expect(payload.apiToken).toBe('test-token');
    expect(payload.imageGenerationConfig).toEqual(patch.imageGenerationConfig);
  });

  it('updates automatic fields but preserves manual values including clearing and false', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'MiniMax-M3' };
    values = { ...values, ...applyModelAutofill(state, { modelCode: values.modelCode }, values) };
    const changed = {
      apiEndpoint: 'https://proxy.example/v1',
      displayName: 'My model',
      maxTokens: 4096,
      temperature: undefined,
      reasoningConfig: { enabled: false, capability: 'binary' },
    };
    values = { ...values, ...changed, modelCode: 'deepseek-flash' };
    const patch = applyModelAutofill(state, changed, values);
    expect(patch).toMatchObject({ contextTokens: 1048576, providerName: 'DeepSeek' });
    Object.keys(changed).forEach((key) => expect(patch).not.toHaveProperty(key));
    expect({ ...values, ...patch }).toMatchObject(changed);
  });

  it('drops stale automatic capabilities for unknown aliases and keeps manually entered capacity', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'deepseek-flash' };
    values = { ...values, ...applyModelAutofill(state, { modelCode: values.modelCode }, values) };
    values.modelCode = 'deepseek-v4-pro-custom';
    let patch = applyModelAutofill(state, { modelCode: values.modelCode }, values);
    expect(patch.contextTokens).toBe(202752);
    expect(patch.maxTokens).toBe(65536);
    expect(patch).not.toHaveProperty('apiEndpoint');
    values = { ...values, ...patch, contextTokens: 8192, modelCode: 'another-alias' };
    patch = applyModelAutofill(state, { contextTokens: 8192, modelCode: values.modelCode }, values);
    expect(patch).not.toHaveProperty('contextTokens');
    expect(patch.maxTokens).toBe(8192);
    expect(findModelFormPreset('ep-private')).toBeUndefined();
  });

  it('selects the official image channel and does not mutate preset objects', () => {
    expect(findModelFormPreset('gpt-image-2')?.id).toBe('OPENAI:gpt-image-2');
    expect(findModelFormPreset('gpt-image-2', 'OPENAI:gpt-image-2')?.values.providerName).toBe('OPENAI');
    const state = createModelAutofillState();
    const values = { ...getNewModelFormValues(), modelCode: 'doubao-seedream-4-0-250828' };
    const patch = applyModelAutofill(state, {}, values);
    expect(patch.contextTokens).toBeUndefined();
    patch.imageGenerationConfig.watermark = false;
    expect(findModelFormPreset(values.modelCode)?.values.imageGenerationConfig.watermark).toBe(true);
    expect(createModelAutofillState().edited.size).toBe(0);
  });

  it('does not overwrite an explicitly selected model type', () => {
    const state = createModelAutofillState();
    const values = { ...getNewModelFormValues(), modelType: 'EMBEDDING', modelCode: 'MiniMax-M3' };
    const patch = applyModelAutofill(state, { modelType: 'EMBEDDING' }, values);
    expect(patch).not.toHaveProperty('modelType');
    expect(patch.contextTokens).toBe(202752);
    expect(patch.maxTokens).toBeUndefined();
  });

  it('limits known official configurations without imposing those limits on proxies or other protocols', () => {
    const values = findModelFormPreset('deepseek-flash')!.values;
    expect(getModelPresetLimits({ ...values, apiEndpoint: `${values.apiEndpoint}/` })).toEqual({
      contextTokens: 1048576,
      maxTokens: 393216,
    });
    expect(getModelPresetLimits({ ...values, apiEndpoint: 'https://proxy.example/v1' })).toBeUndefined();
    expect(getModelPresetLimits({ ...values, modelProtocol: 'Anthropic' })).toBeUndefined();
    expect(getModelPresetLimits({ ...values, modelType: 'EMBEDDING' })).toBeUndefined();
    expect(getModelPresetLimits({ modelCode: 'private-alias' })).toBeUndefined();
  });

  it('preserves manual connection values when a provider shortcut supplies defaults', () => {
    const state = createModelAutofillState();
    state.edited.add('apiEndpoint');
    state.edited.add('modelCode');
    const patch = applyAutofillFields(
      state,
      { ...getNewModelFormValues(), apiEndpoint: 'https://proxy.example', modelCode: 'ep-custom' },
      {
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        modelCode: 'default-image',
        modelProtocol: 'VOLCENGINE_IMAGE',
      }
    );
    expect(patch).toEqual({ modelProtocol: 'VOLCENGINE_IMAGE' });
  });

  it('uses the same sampling values and output budget for saving and new-model debug', () => {
    const values = {
      ...getNewModelFormValues(),
      modelCode: 'custom',
      maxTokens: 4096,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0,
      presencePenalty: 0.2,
    };
    const saved = buildModelUpsertPayload({ values });
    const debug = JSON.parse(
      buildAutoDebugRequestText({
        formValues: values,
        syncFormParameters: true,
        prevText: '{"temperature":0.1,"max_tokens":65536}',
      })
    );
    expect(debug).toMatchObject({
      temperature: saved.temperature,
      top_p: saved.topP,
      max_tokens: saved.maxTokens,
      frequency_penalty: 0,
      presence_penalty: 0.2,
    });
    expect(debug).not.toHaveProperty('enable_thinking');
    const cleared = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...getNewModelFormValues(), maxTokens: undefined },
        syncFormParameters: true,
        prevText: JSON.stringify(debug),
      })
    );
    ['max_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty'].forEach((key) =>
      expect(cleared).not.toHaveProperty(key)
    );
    const headersCleared = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...values, apiToken: '', headers: [] },
        syncFormParameters: true,
        prevText: '{"headers":{"Authorization":"Bearer old-test-token"}}',
      })
    );
    expect(headersCleared.headers).toEqual({});
  });

  it('uses explicit thinking flags for known OpenAI-compatible model templates', () => {
    const values = findModelFormPreset('deepseek-flash')!.values;
    const disabled = JSON.parse(buildAutoDebugRequestText({ formValues: values, syncFormParameters: true }));
    expect(disabled.thinking).toEqual({ type: 'disabled' });
    const enabled = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...values, reasoningConfig: { ...values.reasoningConfig, enabled: true, defaultLevel: 'high' } },
        syncFormParameters: true,
      })
    );
    expect(enabled).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    const lowValues = {
      ...values,
      reasoningConfig: { ...values.reasoningConfig, enabled: true, defaultLevel: 'low' },
    };
    const low = JSON.parse(buildAutoDebugRequestText({ formValues: lowValues, syncFormParameters: true }));
    expect(low.reasoning_effort).toBe('low');
    const mapped = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...lowValues, reasoningEffortMapText: '{"low":"high"}' },
        syncFormParameters: true,
      })
    );
    expect(mapped.reasoning_effort).toBe('high');
    const minimax = JSON.parse(
      buildAutoDebugRequestText({ formValues: findModelFormPreset('MiniMax-M3')!.values, syncFormParameters: true })
    );
    expect(minimax.thinking).toEqual({ type: 'disabled' });
  });
});
