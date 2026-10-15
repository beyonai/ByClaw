import {
  applyAutofillFields,
  applyModelAutofill,
  createModelAutofillState,
  findModelFormPreset,
  getModelPresetLimits,
  getNewModelFormValues,
} from '../modelFormPresets';
import { buildAutoDebugRequestText, buildModelUpsertPayload } from '../modelFormUtils';

describe('deterministic model form presets', () => {
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
    values = { ...values, ...changed, modelCode: 'deepseek-v4-pro' };
    const patch = applyModelAutofill(state, changed, values);
    expect(patch).toMatchObject({ contextTokens: 1048576, providerName: 'DeepSeek' });
    Object.keys(changed).forEach((key) => expect(patch).not.toHaveProperty(key));
    expect({ ...values, ...patch }).toMatchObject(changed);
  });

  it('drops stale automatic capabilities for unknown aliases and keeps manually entered capacity', () => {
    const state = createModelAutofillState();
    let values: Record<string, any> = { ...getNewModelFormValues(), modelCode: 'deepseek-v4-pro' };
    values = { ...values, ...applyModelAutofill(state, { modelCode: values.modelCode }, values) };
    values.modelCode = 'deepseek-v4-pro-custom';
    let patch = applyModelAutofill(state, { modelCode: values.modelCode }, values);
    expect(patch.contextTokens).toBeUndefined();
    expect(patch.maxTokens).toBeUndefined();
    expect(patch).not.toHaveProperty('apiEndpoint');
    values = { ...values, ...patch, contextTokens: 8192, modelCode: 'another-alias' };
    patch = applyModelAutofill(state, { contextTokens: 8192, modelCode: values.modelCode }, values);
    expect(patch).not.toHaveProperty('contextTokens');
    expect(findModelFormPreset('ep-private')).toBeUndefined();
  });

  it('requires an explicit channel for duplicate model codes and does not mutate preset objects', () => {
    expect(findModelFormPreset('gpt-image-2')).toBeUndefined();
    expect(findModelFormPreset('gpt-image-2', 'OPENAI:gpt-image-2')?.values.providerName).toBe('OPENAI');
    const state = createModelAutofillState();
    const values = { ...getNewModelFormValues(), modelCode: 'doubao-seedream-4-0-250828' };
    const patch = applyModelAutofill(state, {}, values);
    patch.imageGenerationConfig.watermark = false;
    expect(findModelFormPreset(values.modelCode)?.values.imageGenerationConfig.watermark).toBe(true);
    expect(createModelAutofillState().edited.size).toBe(0);
  });

  it('does not overwrite an explicitly selected model type', () => {
    const state = createModelAutofillState();
    const values = { ...getNewModelFormValues(), modelType: 'EMBEDDING', modelCode: 'MiniMax-M3' };
    const patch = applyModelAutofill(state, { modelType: 'EMBEDDING' }, values);
    expect(patch).not.toHaveProperty('modelType');
    expect(patch.contextTokens).toBeUndefined();
  });

  it('limits known official configurations without imposing those limits on proxies or other protocols', () => {
    const values = findModelFormPreset('deepseek-v4-pro')!.values;
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
        formValues: getNewModelFormValues(),
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
    const values = findModelFormPreset('deepseek-v4-pro')!.values;
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
