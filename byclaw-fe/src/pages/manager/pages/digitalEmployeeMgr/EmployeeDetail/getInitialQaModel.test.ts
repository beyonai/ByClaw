import getInitialQaModel from './getInitialQaModel';

describe('getInitialQaModel', () => {
  const firstModel = {
    modelId: 10013114,
    modelName: 'MiniMax-M2.7-highspeed',
    modelType: 'LLM',
    isDefault: 0,
  };
  const defaultChatModel = {
    modelId: 11220698,
    modelName: 'deepseek-flash',
    modelType: 'LLM',
    isDefault: 1,
  };
  const defaultVoiceModel = {
    modelId: 11223217,
    modelName: 'doubao-seed-tts-2.0',
    modelType: 'TTS',
    isDefault: 1,
  };

  it.each([1, true, '1'])('prefers the default LLM over the first model with flag %s', (isDefault) => {
    const selectedDefault = { ...defaultChatModel, isDefault };

    expect(getInitialQaModel([firstModel, selectedDefault])).toBe(selectedDefault);
  });

  it('selects the default LLM even when another model type has an earlier default', () => {
    expect(getInitialQaModel([firstModel, defaultVoiceModel, defaultChatModel])).toBe(defaultChatModel);
  });

  it('falls back to the first item when only another model type has a default', () => {
    expect(getInitialQaModel([firstModel, defaultVoiceModel])).toBe(firstModel);
  });

  it.each([0, false, '0', null, undefined])('falls back to the first item without a default: %s', (isDefault) => {
    expect(getInitialQaModel([firstModel, { ...defaultChatModel, isDefault }])).toBe(firstModel);
  });

  it('normalizes the default model type without changing its ID', () => {
    const selectedDefault = { ...defaultChatModel, modelId: '9007199254740993', modelType: ' llm ' };

    expect(getInitialQaModel([firstModel, selectedDefault])).toBe(selectedDefault);
  });

  it('keeps the original list order when selecting a later default', () => {
    const models = Object.freeze([firstModel, defaultChatModel]);

    expect(getInitialQaModel(models)).toBe(defaultChatModel);
    expect(models).toEqual([firstModel, defaultChatModel]);
  });

  it('leaves the selection empty when no models are returned', () => {
    expect(getInitialQaModel([])).toBeUndefined();
    expect(getInitialQaModel(null)).toBeUndefined();
    expect(getInitialQaModel()).toBeUndefined();
  });
});
