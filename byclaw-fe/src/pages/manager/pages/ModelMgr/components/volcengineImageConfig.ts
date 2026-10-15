/** 火山图片配置独立于旧图片表单，避免 MiniMax 参数混入 Ark 请求。 */
export const VOLCENGINE_IMAGE_PROTOCOL = 'VOLCENGINE_IMAGE';

export const SEEDREAM_MODEL_PRESETS = [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-5-0-260128',
  'doubao-seedream-5-0-pro-260628',
  'doubao-seedream-5-0-flash-260915',
];

export function isVolcengineImage(values: any) {
  return values?.modelType === 'IMAGE_GENERATION' && values?.modelProtocol === VOLCENGINE_IMAGE_PROTOCOL;
}

export function getSeedreamSizeSuggestions(modelCode?: string) {
  if (isSeedreamSingleImageModel(modelCode)) return ['1K', '1.5K', '2K'];
  if (modelCode?.startsWith('doubao-seedream-4-0-')) return ['1K', '2K', '4K'];
  // 自定义 ep ID 无法推断能力，允许手工填写尺寸，不擅自切换型号或套用其他版本能力。
  return ['2K'];
}

/** Pro/Flash 只支持单图，不能带入旧版的组图开关和 SSE 参数。 */
export function isSeedreamSingleImageModel(modelCode?: string) {
  return modelCode === 'doubao-seedream-5-0-pro-260628' || modelCode === 'doubao-seedream-5-0-flash-260915';
}

export function buildVolcengineImageParam(values: any) {
  const config = values?.imageGenerationConfig || {};
  return {
    model: `${values?.modelCode || ''}`.trim(),
    prompt: `${values?.prompt ?? ''}`,
    size: config.size || '2K',
    response_format: config.responseFormat || 'url',
    watermark: config.watermark ?? true,
    ...(isSeedreamSingleImageModel(values?.modelCode)
      ? {}
      : { sequential_image_generation: 'disabled', stream: false }),
  };
}

export function getImageConfigFormValues(detail: any) {
  return {
    // 显式清掉上次打开记录的字段，避免切换弹窗记录时串用图片配置。
    extendParam: detail?.extendParam ?? undefined,
    imageGenerationConfig: detail?.imageGenerationConfig != null ? { ...detail.imageGenerationConfig } : undefined,
  };
}

/** 未填写的控件不生成配置；保留未知键，避免新版字段被旧表单保存时抹掉。 */
export function compactImageGenerationConfig(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, field]) => field !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** 仅解析 Ark 的 data 数组；原始 JSON 仍保留供排查单项错误。 */
export function getVolcengineImagePreviews(output: string): string[] {
  try {
    const response = JSON.parse(output);
    if (!Array.isArray(response?.data)) return [];
    return response.data.flatMap((item: any) => {
      if (item?.error) return [];
      if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) return [item.url];
      if (typeof item?.b64_json === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(item.b64_json)) {
        // Seedream 4.0 输出 JPEG；其他版本从文件签名识别，不能一律标为 PNG。
        const mimeType = item.b64_json.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
        return [`data:${mimeType};base64,${item.b64_json}`];
      }
      return [];
    });
  } catch {
    return [];
  }
}
