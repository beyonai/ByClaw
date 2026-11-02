import type { ModelFormPreset } from './modelFormPresets';

// 2026-10-15 按各渠道当前 API 文档核对；搜索摘要中的旧目录不能作为仍在售的依据。
// 均经百炼接入，必须保留供应商前缀，不能改成 DeepSeek/硅基流动原厂地址或密钥。
// 同一模型版本只保留一个入口：优先原厂直连，其次百炼；供应商仅补充独有版本。
const CHANNELS = [
  {
    channel: 'bailian',
    source: 'https://help.aliyun.com/zh/model-studio/deepseek-api',
    models: [
      // V4-Pro 已有非日期的官方直连入口，省略 0813 快照；V4 Flash 与 V4.1 Flash 不合并。
      ['deepseek-v4-flash-0731', 'DeepSeek-V4-Flash-0731'],
    ],
  },
  {
    channel: 'bailianSiliconflow',
    source: 'https://help.aliyun.com/zh/model-studio/siliconflow-deepseek-api',
    models: [
      ['siliconflow/deepseek-v3.1-terminus', 'DeepSeek-V3.1-Terminus'],
      ['siliconflow/deepseek-v3-0324', 'DeepSeek-V3-0324'],
    ],
  },
  {
    channel: 'bailianVanchin',
    source: 'https://help.aliyun.com/zh/model-studio/deepseek-api-by-vanchin',
    models: [
      ['vanchin/deepseek-v3.2-think', 'DeepSeek-V3.2-Think'],
      ['vanchin/deepseek-ocr', 'DeepSeek-OCR'],
    ],
  },
];

export const DEEPSEEK_CHANNEL_PRESETS: ModelFormPreset[] = CHANNELS.flatMap(({ channel, source, models }) =>
  models.map(([modelCode, label]) => ({
    id: `bailian:${modelCode}`,
    label,
    developer: 'deepseek',
    channel,
    source,
    noticeId:
      modelCode === 'vanchin/deepseek-ocr'
        ? 'modelMgr.modal.deepseekBailianOcrPresetHint'
        : 'modelMgr.modal.deepseekBailianPresetHint',
    // 渠道将容量信息指向控制台，不借用原厂或其他供应商的容量，也不强制思考/采样参数。
    values: {
      modelCode,
      modelType: 'LLM',
      providerName: 'Bailian',
      modelProtocol: 'OpenAI',
      apiEndpoint: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    },
  }))
);
