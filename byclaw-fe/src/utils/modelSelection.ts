/** Local picker tokens never cross the remote protocol as model IDs. */
export const AUTO_MODEL_CHOICE = 'auto';

export function modelSelectionPayload(value?: string, thinkingLevel?: string) {
  if (value === AUTO_MODEL_CHOICE) {
    return { modelSelectionMode: 'auto', relThinkingLevel: '-1' };
  }
  if (value === '-1') {
    return {
      modelSelectionMode: 'default',
      relModelId: '-1',
      ...(thinkingLevel ? { relThinkingLevel: thinkingLevel } : {}),
    };
  }
  return {
    ...(value ? { relModelId: value } : {}),
    ...(value && /^[1-9]\d*$/.test(value) ? { modelSelectionMode: 'manual' } : {}),
    ...(thinkingLevel ? { relThinkingLevel: thinkingLevel } : {}),
  };
}
