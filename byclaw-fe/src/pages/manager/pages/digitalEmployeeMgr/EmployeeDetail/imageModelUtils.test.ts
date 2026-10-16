import { applyImageModelId, buildImageModelOptions, normalizeImageModelId } from './imageModelUtils';

describe('imageModelUtils', () => {
  it('keeps enabled image-generation model IDs as strings and excludes other models', () => {
    const options = buildImageModelOptions([
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
    ]);

    expect(options).toEqual([{ label: 'Image Pro', value: '9007199254740993' }]);
  });

  it('does not add an option when no models are available', () => {
    expect(buildImageModelOptions([])).toEqual([]);
  });

  it('keeps only enabled voice models when selecting TTS', () => {
    expect(
      buildImageModelOptions(
        [
          { modelId: '1', modelName: 'Image Model', modelType: 'IMAGE_GENERATION', status: 'ENABLED' },
          { modelId: '2', modelName: 'Voice Model', modelType: 'TTS', status: 'ENABLED' },
          { modelId: '3', modelName: 'Disabled Voice', modelType: 'TTS', status: 'DISABLED' },
        ],
        'TTS'
      )
    ).toEqual([{ label: 'Voice Model', value: '2' }]);
  });

  it('normalizes an empty selection without losing a large string ID', () => {
    expect(normalizeImageModelId('')).toBeUndefined();
    expect(normalizeImageModelId('9007199254740993')).toBe('9007199254740993');
  });

  it('serializes a selected image model as a string', () => {
    const payload: Record<string, unknown> = { resourceName: 'Artist', imageModelId: 'old-model' };

    applyImageModelId(payload, '9007199254740993');
    expect(payload.imageModelId).toBe('9007199254740993');
  });

  it.each([undefined, null, ''])('allows saving an empty model selection: %s', (value) => {
    const payload: Record<string, unknown> = { resourceName: 'Artist', imageModelId: 'old-model' };

    applyImageModelId(payload, value);

    expect(payload).toEqual({ resourceName: 'Artist' });
  });
});
