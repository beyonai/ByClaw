import { applyImageModelId, buildImageModelOptions, normalizeImageModelId } from './imageModelUtils';

describe('imageModelUtils', () => {
  it('keeps enabled image-generation model IDs as strings and excludes other models', () => {
    const options = buildImageModelOptions(
      [
        {
          id: '9007199254740993',
          displayName: 'Image Pro',
          modelType: 'IMAGE_GENERATION',
          status: 'ENABLED',
        },
        {
          modelId: '2',
          modelName: 'Disabled Image',
          modelType: 'IMAGE_GENERATION',
          status: 'DISABLED',
        },
        { modelId: '3', modelName: 'Chat Model', modelType: 'LLM', status: 'ENABLED' },
        { modelId: '4', modelName: 'Missing Type', status: 'ENABLED' },
        { modelId: '5', modelName: 'Missing Status', modelType: 'IMAGE_GENERATION' },
      ],
      '跟随全局默认'
    );

    expect(options).toEqual([
      { label: '跟随全局默认', value: '' },
      { label: 'Image Pro', value: '9007199254740993' },
    ]);
  });

  it('normalizes an empty selection to the global default without losing a large string ID', () => {
    expect(normalizeImageModelId('')).toBeUndefined();
    expect(normalizeImageModelId('9007199254740993')).toBe('9007199254740993');
  });

  it('serializes a selected image model as a string and deletes the field for the global default', () => {
    const payload: Record<string, unknown> = { resourceName: 'Artist', imageModelId: 'old-model' };

    applyImageModelId(payload, '9007199254740993');
    expect(payload.imageModelId).toBe('9007199254740993');

    applyImageModelId(payload, '');
    expect(payload).toEqual({ resourceName: 'Artist' });
  });
});
