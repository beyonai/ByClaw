import { MODEL_FORM_PRESETS, getPresetOptions } from '../modelFormPresets';
import { getVisiblePresetOptions } from '../modelPresetCatalog';

describe('single model template list', () => {
  it('shows every registered template in model name order by default', () => {
    expect(getVisiblePresetOptions({})).toEqual(getPresetOptions());
    expect(getVisiblePresetOptions({})).toHaveLength(MODEL_FORM_PRESETS.length);
    expect(getVisiblePresetOptions({}).some(({ value }) => value === 'minimax:MiniMax-M2.7')).toBe(true);
  });

  it('finds older versions and request aliases and prioritizes exact matches', () => {
    expect(getVisiblePresetOptions({ search: 'MiniMax-M2.7' })[0].value).toBe('minimax:MiniMax-M2.7');
    expect(getVisiblePresetOptions({ search: '  qwen3.6_PLUS  ' })[0].value).toBe('bailian:qwen3.6-plus');
    expect(getVisiblePresetOptions({ search: 'kimi-for-coding' })[0].value).toBe('kimi-code:kimi-for-coding');
    expect(getVisiblePresetOptions({ search: 'model2' })).toEqual([]);
  });

  it('uses official API names consistently across Qwen model types and keeps case-insensitive search', () => {
    const qwenPresets = MODEL_FORM_PRESETS.filter(
      ({ developer, values }) => developer === 'alibaba' && values.modelCode.startsWith('qwen')
    );
    expect(new Set(qwenPresets.map(({ values }) => values.modelType))).toEqual(
      new Set(['LLM', 'EMBEDDING', 'RERANK', 'IMAGE_GENERATION'])
    );
    qwenPresets.forEach(({ id, label, values }) => {
      expect(label).toBe(values.modelCode);
      const options = getVisiblePresetOptions({ search: values.modelCode.toUpperCase() });
      expect(options[0]).toEqual({ value: id, label: values.modelCode });
    });
  });

  it('supports Chinese developer aliases', () => {
    const options = getVisiblePresetOptions({ search: '千问' });
    expect(options.length).toBeGreaterThan(0);
    expect(
      options.every(({ value }) => MODEL_FORM_PRESETS.find((preset) => preset.id === value)?.developer === 'alibaba')
    ).toBe(true);
  });

  it.each([
    ['OpenAI', 'openai:gpt-6.1-sol'],
    ['谷歌', 'google:gemini-4-argon'],
    ['Claude', 'anthropic:claude-opus-5-5'],
    ['千问', 'bailian:qwen3.8-flash'],
    ['qwen3.7_text_embedding', 'bailian:qwen3.7-text-embedding'],
    ['gte-rerank-v2', 'bailian:gte-rerank-v2'],
    ['豆包', 'volcengine:doubao-seed-2-1-pro-260915'],
    ['混元', 'tokenhub:hy4-preview'],
    ['小米', 'tokenhub:mimo-v2.6-pro'],
    ['阶跃星辰', 'tokenhub:step-5-preview'],
    ['文心', 'aistudio:ernie-5.1'],
    ['星火', 'xfyun:spark-x2.5'],
    ['智源', 'siliconflow:BAAI/bge-m3'],
    ['网易', 'siliconflow:netease-youdao/bce-reranker-base_v1'],
    ['百川', 'baichuan:Baichuan4-Turbo'],
    ['商汤', 'sensenova:sensenova-6.8-flash-lite'],
  ])('finds expanded templates by %s', (search, value) => {
    expect(getVisiblePresetOptions({ search }).map((option) => option.value)).toContain(value);
  });

  it('keeps separate channel IDs even when the model names are identical', () => {
    const first = MODEL_FORM_PRESETS[0];
    // 测试夹具验证渠道不会合并，不代表目录新增此接入渠道。
    const second = { ...first, id: 'fixture:bailian', channel: 'bailian' };
    const options = getVisiblePresetOptions({ presets: [first, second], search: first.label });
    expect(options.map(({ value }) => value)).toEqual([first.id, second.id]);
  });
});
