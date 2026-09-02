import type { ModelListByPageResponse, ModelListItem } from '@/pages/manager/service/ModelMgr';

export interface ImageModelOption {
  label: string;
  value: string;
}

export const normalizeImageModelId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
};

export const getImageModelRows = (response?: ModelListByPageResponse): ModelListItem[] => {
  const page = response?.data || response;
  if (Array.isArray(page?.rows)) return page.rows;
  if (Array.isArray(page?.list)) return page.list;
  return [];
};

export const buildImageModelOptions = (
  models: ModelListItem[] = [],
  globalDefaultLabel: string,
  includeGlobalDefault: boolean = true,
  modelType: string = 'IMAGE_GENERATION'
): ImageModelOption[] => {
  const normalizedModelType = modelType.trim().toUpperCase();
  const options = models
    .filter(
      (model) =>
        `${model.modelType || ''}`.trim().toUpperCase() === normalizedModelType &&
        `${model.status || ''}`.trim().toUpperCase() === 'ENABLED'
    )
    .map((model) => {
      const value = normalizeImageModelId(model.modelId ?? model.id);
      if (!value) return null;
      return {
        label: model.displayName || model.modelName || model.modelCode || value,
        value,
      };
    })
    .filter((option): option is ImageModelOption => option !== null);

  return includeGlobalDefault ? [{ label: globalDefaultLabel, value: '' }, ...options] : options;
};

export const applyImageModelId = (payload: Record<string, unknown>, value: unknown): void => {
  const imageModelId = normalizeImageModelId(value);
  if (imageModelId === undefined) {
    delete payload.imageModelId;
    return;
  }
  payload.imageModelId = imageModelId;
};
