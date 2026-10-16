import zh from '@/locales/zh-CN/manager';
import en from '@/locales/en-US/manager';
import {
  applyModelAutofill,
  createModelAutofillState,
  findModelFormPreset,
  getModelPresetLimits,
  getNewModelFormValues,
  MODEL_FORM_PRESETS,
} from '../modelFormPresets';
import { buildAutoDebugRequestText, buildDebugPayload, buildModelUpsertPayload } from '../modelFormUtils';
import { getVisiblePresetOptions } from '../modelPresetCatalog';

function select(id: string): Record<string, any> {
  const preset = MODEL_FORM_PRESETS.find((item) => item.id === id)!;
  expect(preset).toBeDefined();
  const values = { ...getNewModelFormValues(), modelCode: preset.values.modelCode, apiToken: 'fixture-token' };
  return { ...values, ...applyModelAutofill(createModelAutofillState(), {}, values, id) };
}

function debug(id: string) {
  return JSON.parse(
    buildAutoDebugRequestText({
      formValues: select(id),
      syncFormParameters: true,
      defaultUserMessage: 'hello',
    })
  );
}

describe('domestic official templates', () => {
  it.each([
    ['deepseek-v4-flash-0731', 'bailian'],
    ['siliconflow/deepseek-v3.1-terminus', 'bailianSiliconflow'],
    ['siliconflow/deepseek-v3-0324', 'bailianSiliconflow'],
    ['vanchin/deepseek-v3.2-think', 'bailianVanchin'],
    ['vanchin/deepseek-ocr', 'bailianVanchin'],
  ])('keeps the active DeepSeek channel contract for %s', (modelCode, channel) => {
    const id = `bailian:${modelCode}`;
    const preset = MODEL_FORM_PRESETS.find((item) => item.id === id)!;
    expect(preset).toMatchObject({ developer: 'deepseek', channel });
    expect(preset.label).toMatch(/^DeepSeek-/);
    expect(preset.limits).toBeUndefined();
    expect(getVisiblePresetOptions({ search: 'dee' }).map((option) => option.value)).toContain(id);
    expect(getVisiblePresetOptions({ search: '深度求索' }).map((option) => option.value)).toContain(id);
    const values = select(id);
    expect(buildModelUpsertPayload({ values })).toMatchObject({ modelCode, providerName: 'Bailian' });
    expect(values.apiEndpoint).toContain('{WorkspaceId}.cn-beijing.maas.aliyuncs.com');
    // 用户按提示替换业务空间后，调试仍须保留供应商前缀和百炼 Bearer 认证。
    const request = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...values, apiEndpoint: values.apiEndpoint.replace('{WorkspaceId}', 'workspace-fixture') },
        syncFormParameters: true,
      })
    );
    expect(request).toMatchObject({
      model: modelCode,
      url: 'https://workspace-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      headers: { Authorization: 'Bearer fixture-token' },
    });
    expect(request).not.toHaveProperty('thinking');
    expect(request).not.toHaveProperty('enable_thinking');
    expect(preset.noticeId).toBe(
      modelCode === 'vanchin/deepseek-ocr'
        ? 'modelMgr.modal.deepseekBailianOcrPresetHint'
        : 'modelMgr.modal.deepseekBailianPresetHint'
    );
  });

  it('keeps one entry per DeepSeek version and prefers direct access', () => {
    const presets = MODEL_FORM_PRESETS.filter((preset) => preset.developer === 'deepseek');
    // Flash 的原厂 API 别名仍保留在展示名中，比较版本时仅去掉该后缀。
    const names = presets.map((preset) => preset.label.replace(/ \(.*\)$/, ''));
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(names.length);
    expect(findModelFormPreset('deepseek-v4-pro')?.id).toBe('deepseek:deepseek-v4-pro');
    expect(findModelFormPreset('deepseek-flash')?.id).toBe('deepseek:deepseek-flash');
    expect(findModelFormPreset('deepseek-v4-pro-0813')).toBeUndefined();
    const ids = MODEL_FORM_PRESETS.map((preset) => preset.id);
    [
      'deepseek-v4-pro-0813',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'vanchin/deepseek-v4.1-flash',
      'vanchin/deepseek-v4-pro',
      'vanchin/deepseek-v4-pro-0813',
      'vanchin/deepseek-v3.1-terminus',
      'deepseek-v3',
      'deepseek-v3.1',
      'deepseek-v3.2',
      'deepseek-v3.2-exp',
      'deepseek-r1',
      'deepseek-r1-0528',
      'siliconflow/deepseek-v3.2',
      'siliconflow/deepseek-r1-0528',
      'vanchin/deepseek-r1',
      'vanchin/deepseek-v3',
    ].forEach((modelCode) => expect(ids).not.toContain(`bailian:${modelCode}`));
  });

  it.each([
    ['tokenhub:kimi-k2.7-code-highspeed', 'Kimi-K2.7-Code-HighSpeed', 'kimi-k2.7-code-highspeed'],
    ['bailian:kimi-k2.6', 'Kimi-K2.6', 'kimi-k2.6'],
    ['bailian:kimi-k2.7-code', 'Kimi-K2.7-Code', 'kimi-k2.7-code'],
    ['kimi-code:kimi-for-coding', 'Kimi-K2.8-Preview (kimi-for-coding)', 'kimi-for-coding'],
    ['bailian:kimi-k3', 'Kimi-K3', 'kimi-k3'],
  ])('uses consistent Kimi display separators without changing the API model: %s', (id, label, modelCode) => {
    // 各渠道统一展示连字符，但保留独立的接口型号（包括 Kimi Code 专用型号）。
    expect(MODEL_FORM_PRESETS.find((preset) => preset.id === id)?.label).toBe(label);
    const values = select(id);
    expect(values.modelCode).toBe(modelCode);
    expect(buildModelUpsertPayload({ values }).modelCode).toBe(modelCode);
    expect(debug(id).model).toBe(modelCode);
  });

  it('displays bge-m3 in lowercase while preserving the API model code', () => {
    const id = 'siliconflow:BAAI/bge-m3';
    // 展示名称与同系列模板保持一致，自动填充和提交仍使用渠道要求的完整型号。
    expect(MODEL_FORM_PRESETS.find((preset) => preset.id === id)?.label).toBe('bge-m3');
    const values = select(id);
    expect(values.modelCode).toBe('BAAI/bge-m3');
    expect(buildModelUpsertPayload({ values }).modelCode).toBe('BAAI/bge-m3');
    expect(debug(id).model).toBe('BAAI/bge-m3');
  });

  it.each([
    ['baichuan:Baichuan4-Turbo', 'https://api.baichuan-ai.com/v1/chat/completions', 32768, 32768],
    ['baichuan:Baichuan4-Air', 'https://api.baichuan-ai.com/v1/chat/completions', 32768, 32768],
    ['baichuan:Baichuan-Text-Embedding', 'https://api.baichuan-ai.com/v1/embeddings', 512, undefined],
    ['zhipu:embedding-3', 'https://open.bigmodel.cn/api/paas/v4/embeddings', 8192, undefined],
    ['sensenova:sensenova-6.8-flash-lite', 'https://token.sensenova.cn/v1/chat/completions', 202752, 65536],
  ])('uses a context-bounded fallback only for text generation: %s', (id, url, contextTokens, maxTokens) => {
    const values = select(String(id));
    expect(values.contextTokens).toBe(contextTokens);
    expect(values.maxTokens).toBe(maxTokens);
    expect(getModelPresetLimits(values)?.maxTokens).toBeUndefined();
    expect(buildModelUpsertPayload({ values }).maxTokens).toBe(maxTokens);
    expect(debug(String(id)).url).toBe(url);
    expect(debug(String(id)).max_tokens).toBe(maxTokens);
  });
  // 独立列出各渠道的规格，验证实际自动填充与提交值，不依赖目录自己的 limits 作期望。
  it.each([
    ['volcengine:doubao-seed-2-1-pro-260915', 1048576, 262144, 'https://ark.cn-beijing.volces.com/api/v3'],
    ['volcengine:doubao-seed-2-1-turbo-260628', 262144, 262144, 'https://ark.cn-beijing.volces.com/api/v3'],
    ['tokenhub:hy4-preview', 1048576, 65536, 'https://tokenhub.tencentmaas.com/v1'],
    ['tokenhub:hy3', 262144, 131072, 'https://tokenhub.tencentmaas.com/v1'],
    ['tokenhub:mimo-v2.6-pro', 1048576, 131072, 'https://tokenhub.tencentmaas.com/v1'],
    ['tokenhub:step-5-preview', 1048576, 65536, 'https://tokenhub.tencentmaas.com/v1'],
    ['tokenhub:glm-5.3-flashx', 1048576, 131072, 'https://tokenhub.tencentmaas.com/v1'],
    ['aistudio:ernie-5.1', 131072, 65536, 'https://aistudio.baidu.com/llm/lmapi/v3'],
    ['aistudio:ernie-x1.1-preview', 65536, 65536, 'https://aistudio.baidu.com/llm/lmapi/v3'],
    ['bailian:stepfun/step-3.7-flash', 262144, 262144, 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['bailian:qwen3.7-plus', 1000000, 131072, 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['bailian:qwen3.7-flash', 1000000, 131072, 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
  ])('saves the verified endpoint and limits for %s', (id, contextTokens, maxTokens, apiEndpoint) => {
    const values = select(String(id));
    expect(buildModelUpsertPayload({ values })).toMatchObject({
      contextTokens,
      maxTokens,
      apiEndpoint,
      modelProtocol: 'OpenAI',
      apiToken: 'fixture-token',
    });
    expect(debug(String(id))).toMatchObject({
      url: `${apiEndpoint}/chat/completions`,
      max_tokens: maxTokens,
      model: values.modelCode,
      headers: { Authorization: 'Bearer fixture-token' },
    });
    expect(buildModelUpsertPayload({ values })).not.toHaveProperty('channel');
  });

  it.each(['spark-x2.5', 'spark-x2.5-4b', 'spark-x2.5-1.7b'])(
    'uses the Spark API total budget without inventing an output ceiling: %s',
    (modelCode) => {
      const values = select(`xfyun:${modelCode}`);
      expect(values.contextTokens).toBe(262144);
      const request = debug(`xfyun:${modelCode}`);
      expect(request.url).toBe('https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions');
      expect(request.max_tokens).toBe(65536);
      expect(getModelPresetLimits(values)?.maxTokens).toBeUndefined();
      ['temperature', 'top_p', 'thinking', 'reasoning_effort'].forEach((key) => {
        expect(request).not.toHaveProperty(key);
      });
    }
  );

  it.each([
    ['siliconflow:BAAI/bge-m3', 8192],
    ['siliconflow:BAAI/bge-large-zh-v1.5', 512],
    ['siliconflow:netease-youdao/bce-embedding-base_v1', 512],
  ])('uses the text embeddings contract for %s', (id, contextTokens) => {
    expect(select(String(id)).contextTokens).toBe(contextTokens);
    expect(debug(String(id))).toEqual({
      url: 'https://api.siliconflow.cn/v1/embeddings',
      headers: { Authorization: 'Bearer fixture-token' },
      model: String(id).slice('siliconflow:'.length),
      input: 'hello',
    });
  });

  it('keeps native multimodal embedding inputs and never appends another embeddings suffix', () => {
    const bailian = select('bailian:qwen3-vl-embedding');
    expect(bailian.contextTokens).toBe(32000);
    expect(debug('bailian:qwen3-vl-embedding')).toMatchObject({
      url: bailian.apiEndpoint,
      input: { contents: [{ text: 'hello' }] },
    });
    const input = { contents: [{ image: 'https://example.test/image.png' }, { text: 'whale' }] };
    const previous = JSON.stringify({ input, parameters: { fusion: true } });
    expect(JSON.parse(buildAutoDebugRequestText({ formValues: bailian, prevText: previous }))).toMatchObject({
      input,
      parameters: { fusion: true },
    });
    const ark = select('volcengine:doubao-embedding-vision-251215');
    expect(ark.contextTokens).toBe(131072);
    const switched = JSON.parse(
      buildAutoDebugRequestText({
        formValues: ark,
        prevText: previous,
        changedKeys: ['modelProtocol'],
        defaultUserMessage: 'hello',
      })
    );
    expect(switched).toMatchObject({
      url: 'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
      input: [{ type: 'text', text: 'hello' }],
      encoding_format: 'float',
    });
    expect(switched).not.toHaveProperty('parameters');
    const standard = JSON.parse(
      buildAutoDebugRequestText({
        formValues: { ...ark, modelProtocol: 'OpenAI', apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3' },
        prevText: JSON.stringify(switched),
        changedKeys: ['modelProtocol'],
      })
    );
    expect(standard.url).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings');
    expect(typeof standard.input).toBe('string');
  });

  it.each(['BAAI/bge-reranker-v2-m3', 'netease-youdao/bce-reranker-base_v1'])(
    'generates SiliconFlow rerank documents with Bearer auth: %s',
    (modelCode) => {
      const values = select(`siliconflow:${modelCode}`);
      expect(values.contextTokens).toBe(202752);
      expect(getModelPresetLimits(values)?.contextTokens).toBeUndefined();
      expect(buildModelUpsertPayload({ values }).contextTokens).toBe(202752);
      const request = debug(`siliconflow:${modelCode}`);
      expect(request).toMatchObject({
        url: 'https://api.siliconflow.cn/v1/rerank',
        model: modelCode,
        headers: { Authorization: 'Bearer fixture-token' },
        documents: expect.arrayContaining([expect.any(String)]),
        query: expect.any(String),
      });
      expect(request).not.toHaveProperty('docs');
      expect(request.headers).not.toHaveProperty('X-Api-Key');
    }
  );

  it('preserves image queries in Qwen multimodal rerank without leaking LLM fields', () => {
    const values = select('bailian:qwen3-vl-rerank');
    expect(values.contextTokens).toBe(8000);
    const input = { query: { image: 'https://example.test/query.png' }, documents: [{ text: 'a whale' }] };
    const request = JSON.parse(
      buildAutoDebugRequestText({
        formValues: values,
        prevText: JSON.stringify({ input, parameters: { top_n: 1 } }),
      })
    );
    expect(request.input).toEqual(input);
    expect(request.parameters).toEqual({ top_n: 1 });
    expect(request).not.toHaveProperty('max_tokens');
    expect(select('bailian:qwen3-rerank').contextTokens).toBe(4000);
  });

  it.each([
    ['bailian:qwen-image-3.0-pro', 'BAILIAN_IMAGE'],
    ['bailian:wan2.7-image', 'BAILIAN_IMAGE'],
    ['tokenhub:hy-image-v3', 'TOKENHUB_IMAGE'],
    ['tokenhub:hy-image-v3.5-preview', 'TOKENHUB_IMAGE'],
  ])('uses a dedicated image protocol for %s', (id, modelProtocol) => {
    const values = { ...select(id), prompt: 'a whale', aspectRatio: '1:1', promptOptimizer: true };
    const payload = buildModelUpsertPayload({ values: { ...values, providerName: undefined } });
    expect(payload.providerName).toBe(modelProtocol === 'BAILIAN_IMAGE' ? 'BAILIAN' : 'TOKENHUB');
    expect(payload.apiEndpoint).toBe(values.apiEndpoint);
    expect(payload).not.toHaveProperty('prompt');
    const { param, url } = buildDebugPayload(values).input;
    expect(url).toBe(values.apiEndpoint);
    if (modelProtocol === 'BAILIAN_IMAGE') {
      expect(param).toEqual({
        model: values.modelCode,
        input: { messages: [{ role: 'user', content: [{ text: 'a whale' }] }] },
        parameters: { n: 1 },
      });
    } else if (values.modelCode === 'hy-image-v3') {
      expect(param).toEqual({ model: 'hy-image-v3', prompt: 'a whale' });
    } else {
      expect(param).toEqual({
        model: 'hy-image-v3.5-preview',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'a whale' }] }],
      });
    }
  });

  it('localizes all developer, channel and notice labels in both languages', () => {
    MODEL_FORM_PRESETS.forEach(({ developer, channel, noticeId }) => {
      const keys = [
        developer && `modelMgr.modal.presetDeveloper.${developer}`,
        channel && `modelMgr.modal.presetChannel.${channel}`,
        noticeId,
      ].filter(Boolean);
      keys.forEach((key) => {
        expect((zh as Record<string, string>)[key!]).toBeTruthy();
        expect((en as Record<string, string>)[key!]).toBeTruthy();
      });
    });
  });
});
