import { SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { applyReasoningTranslations, translatedThinkingItems } from '../reasoningTranslation';
import { readReasoningTranslationSettings, writeReasoningTranslationSettings } from '../reasoningTranslationSettings';

const translation = { seq: 1, text: '我先检查日志。', sourceLength: 18, revision: 1, status: 'done' as const };
const item = {
  seq: 1,
  contentType: SSEMessageType.thinkText,
  content: { substance: 'I will check logs.' },
} as IMessageListItem;

describe('Chinese reasoning display', () => {
  it('replaces display copies, preserves raw source and ignores replayed older revisions', () => {
    const message = { thinkList: [item] } as IMessage;
    applyReasoningTranslations(message, [translation]);
    applyReasoningTranslations(message, [{ ...translation, revision: 0, text: '旧译文' }]);
    expect(translatedThinkingItems([item], message)[0].content.substance).toBe('我先检查日志。');
    expect(item.content.substance).toBe('I will check logs.');
    expect(translatedThinkingItems([item])[0]).toBe(item);
  });

  it('uses persisted translations for history and hides pending English', () => {
    const persisted = { ...item, reasoningTranslation: { ...translation, text: '', status: 'pending' as const } };
    expect(translatedThinkingItems([persisted])[0].content.substance).toContain('正在转换中文');
    expect(translatedThinkingItems([persisted])[0].content.substance).not.toContain('I will');
    const done = { ...persisted, reasoningTranslation: translation };
    expect(translatedThinkingItems([done])[0].content.substance).toBe(translation.text);
    expect(
      translatedThinkingItems([done], {
        reasoningTranslations: { 1: { ...translation, revision: 0, text: '旧译文' } },
      } as IMessage)[0].content.substance
    ).toBe(translation.text);
  });

  it('leaves tool cards untouched when there is no translation', () => {
    const tool = {
      seq: 2,
      contentType: SSEMessageType.toolCall,
      content: { substance: { arguments: { query: 'English' } } },
    } as unknown as IMessageListItem;
    expect(translatedThinkingItems([tool], { reasoningTranslations: { 1: translation } } as IMessage)[0]).toBe(tool);
  });
});

describe('reasoning translation settings', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('defaults off, isolates sessions and transfers draft settings to the created session', () => {
    expect(readReasoningTranslationSettings().translateReasoning).toBe(false);
    writeReasoningTranslationSettings(undefined, { translateReasoning: true, reasoningTranslationModelId: '42' });
    expect(readReasoningTranslationSettings('session-1')).toEqual({
      translateReasoning: true,
      reasoningTranslationModelId: '42',
    });
    expect(readReasoningTranslationSettings('session-2').translateReasoning).toBe(false);
    expect(readReasoningTranslationSettings().translateReasoning).toBe(false);
  });

  it('does not enable translation without a selected model', () => {
    writeReasoningTranslationSettings('session-1', { translateReasoning: true });
    expect(readReasoningTranslationSettings('session-1').translateReasoning).toBe(false);
  });
});
