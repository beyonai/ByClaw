import {
  THINKING_LEVEL_DEFAULT_SIGNAL,
  THINKING_LEVELS,
  thinkingCapabilityTag,
  thinkingLevelLabel,
  thinkingLevelsFor,
  thinkingPanelHint,
  thinkingPanelTitle,
} from './thinkingLevel';

let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

it('resolves labels at call time and preserves the runtime vocabulary when the language changes', () => {
  const reasoning = { enabled: true, capability: 'effort', supportedEfforts: ['low', 'high'] };
  mockLocale = 'zh-CN';
  expect(thinkingLevelLabel('high')).toBe('深入');
  expect(thinkingPanelTitle()).toBe('推理强度');
  expect(thinkingCapabilityTag(reasoning)).toBe('支持分档');
  mockLocale = 'en-US';
  expect(thinkingLevelLabel('high')).toBe('High');
  expect(thinkingPanelTitle()).toBe('Reasoning effort');
  expect(thinkingPanelHint({ preview: false, explicitLevel: 'high' })).toBe('Applied starting with the next message');
  expect(thinkingPanelHint({ preview: true })).toBe('Hover to preview. Select a model to adjust.');
  expect(thinkingPanelHint({ preview: false })).toBe('Currently using the model default');
  expect(THINKING_LEVELS.map(thinkingLevelLabel)).toEqual([
    'Off',
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Adaptive',
    'Maximum',
  ]);
  expect(thinkingLevelsFor(reasoning)).toEqual(['off', 'low', 'high']);
  expect(THINKING_LEVEL_DEFAULT_SIGNAL).toBe('-1');
  expect(thinkingLevelLabel('unknown')).toBe('');
  expect(thinkingCapabilityTag({ enabled: false })).toBeUndefined();
});
