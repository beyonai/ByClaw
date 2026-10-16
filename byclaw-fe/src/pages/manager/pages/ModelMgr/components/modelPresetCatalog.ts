import { getPresetOptions, MODEL_FORM_PRESETS } from './modelFormPresets';
import type { ModelFormPreset } from './modelFormPresets';

const SEARCH_ALIASES: Record<string, string> = {
  alibaba: '千问 通义 Qwen Alibaba 阿里',
  bytedance: '豆包 Doubao Seedream 字节跳动',
  zhipu: '智谱 GLM Zhipu',
  moonshot: '月之暗面 Kimi Moonshot',
  deepseek: '深度求索 DeepSeek',
  anthropic: 'Claude Anthropic',
  google: '谷歌 Google Gemini',
  openai: 'OpenAI GPT',
  minimax: 'MiniMax 稀宇',
  xai: 'xAI Grok',
  tencent: '腾讯 混元 Hunyuan Tencent Hy',
  xiaomi: '小米 MiMo Xiaomi',
  stepfun: '阶跃星辰 阶跃 Step StepFun',
  baidu: '百度 文心 ERNIE Baidu',
  iflytek: '讯飞 星火 Spark iFLYTEK',
  baai: '智源 BGE BAAI',
  netease: '网易 有道 BCE NetEase Youdao',
  baichuan: '百川 Baichuan',
  sensetime: '商汤 日日新 SenseNova SenseTime',
};

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

/** 全部官方模板平铺展示，渠道直接体现在选项中，一次选择即可确定真实模板 ID。 */
export function getVisiblePresetOptions({
  presets = MODEL_FORM_PRESETS,
  search = '',
  locale = 'zh-CN',
  formatLabel = (preset: ModelFormPreset) => preset.label,
}: {
  presets?: ModelFormPreset[];
  search?: string;
  locale?: string;
  formatLabel?: (preset: ModelFormPreset) => string;
}) {
  const query = normalize(search);
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  return getPresetOptions(presets, locale, formatLabel)
    .filter((option) => {
      const preset = byId.get(option.value)!;
      return normalize(
        `${option.label} ${preset.values.modelCode} ${SEARCH_ALIASES[preset.developer || ''] || ''}`
      ).includes(query);
    })
    .sort((left, right) => {
      // 搜索时精确型号优先，其余结果保留型号自然排序。
      const exact = (id: string) => {
        const preset = byId.get(id)!;
        return !!query && [preset.label, preset.values.modelCode].some((value) => normalize(value) === query);
      };
      return Number(exact(right.value)) - Number(exact(left.value));
    });
}
