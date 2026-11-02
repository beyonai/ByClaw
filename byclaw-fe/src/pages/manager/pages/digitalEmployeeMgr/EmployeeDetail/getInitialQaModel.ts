interface QaModel {
  modelId: string | number;
  modelName: string;
  modelType?: string | null;
  isDefault?: number | boolean | string | null;
}

/**
 * 问答配置优先使用默认 LLM；默认标记按模型类型独立，不能误选 TTS 等类型的默认模型。
 * 未找到默认 LLM 时保留原有的列表首项兜底，空列表则不选择模型。
 */
export default function getInitialQaModel(models: readonly QaModel[] | null = []): QaModel | undefined {
  const availableModels = models ?? [];
  const defaultModel = availableModels.find(
    ({ modelType, isDefault }) =>
      modelType?.trim().toUpperCase() === 'LLM' && (isDefault === 1 || isDefault === true || isDefault === '1')
  );

  return defaultModel ?? availableModels[0];
}
