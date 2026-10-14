import { modelSelectionPayload } from './modelSelection';

describe('model selection protocol', () => {
  it('Auto clears the thinking override and never sends a model ID', () => {
    expect(modelSelectionPayload('auto', 'high')).toEqual({ modelSelectionMode: 'auto', relThinkingLevel: '-1' });
  });

  it('defaults to Auto while preserving explicit manual and desktop local selections', () => {
    expect(modelSelectionPayload('-1')).toEqual({ modelSelectionMode: 'auto', relThinkingLevel: '-1' });
    expect(modelSelectionPayload('42', 'low')).toEqual({
      modelSelectionMode: 'manual',
      relModelId: '42',
      relThinkingLevel: 'low',
    });
    expect(modelSelectionPayload('local-model')).toEqual({ relModelId: 'local-model' });
    expect(modelSelectionPayload()).toEqual({ modelSelectionMode: 'auto', relThinkingLevel: '-1' });
    expect(modelSelectionPayload('', 'high')).toEqual({ modelSelectionMode: 'auto', relThinkingLevel: '-1' });
    expect(modelSelectionPayload(undefined, undefined, false)).toEqual({});
  });
});
