export type ReasoningTranslationSettings = {
  translateReasoning: boolean;
  reasoningTranslationModelId?: string;
};

const keyFor = (sessionId?: string) => `byclaw.session.reasoning-translation.${sessionId || 'new'}`;

export const readReasoningTranslationSettings = (sessionId?: string): ReasoningTranslationSettings => {
  const defaults = { translateReasoning: false };
  if (typeof window === 'undefined') return defaults;
  try {
    const key = keyFor(sessionId);
    let stored = window.sessionStorage.getItem(key);
    // Transfer the draft settings once the first turn creates its real session.
    if (!stored && sessionId) {
      stored = window.sessionStorage.getItem(keyFor());
      if (stored) {
        window.sessionStorage.setItem(key, stored);
        window.sessionStorage.removeItem(keyFor());
      }
    }
    const parsed = JSON.parse(stored || '{}');
    return {
      translateReasoning: parsed.translateReasoning === true && Boolean(parsed.reasoningTranslationModelId),
      reasoningTranslationModelId: parsed.reasoningTranslationModelId,
    };
  } catch (error) {
    return defaults;
  }
};

export const writeReasoningTranslationSettings = (
  sessionId: string | undefined,
  settings: ReasoningTranslationSettings
) => {
  try {
    window.sessionStorage.setItem(keyFor(sessionId), JSON.stringify(settings));
  } catch (error) {
    // The current mounted control still works when browser storage is unavailable.
  }
};
