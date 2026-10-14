import { modelSelectionPayload } from './modelSelection';

describe('model selection protocol', () => {
  it('Auto clears the thinking override and never sends a model ID', () => {
    expect(modelSelectionPayload('auto', 'high')).toEqual({ modelSelectionMode: 'auto', relThinkingLevel: '-1' });
  });

  it('keeps default, manual and desktop local selections distinct', () => {
    expect(modelSelectionPayload('-1')).toEqual({ modelSelectionMode: 'default', relModelId: '-1' });
    expect(modelSelectionPayload('42', 'low')).toEqual({
      modelSelectionMode: 'manual',
      relModelId: '42',
      relThinkingLevel: 'low',
    });
    expect(modelSelectionPayload('local-model')).toEqual({ relModelId: 'local-model' });
    expect(modelSelectionPayload()).toEqual({});
  });
});
