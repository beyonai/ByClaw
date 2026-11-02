import {
  buildDshInteractionResumePayload,
  isDshInteractionResume,
  resolveDshInteractionId,
  resolveDshResumeRoute,
  resolveResumeTraceId,
} from './resumePayload';

describe('buildDshInteractionResumePayload', () => {
  it('puts the interaction route and structured answers on the Resume payload', () => {
    expect(
      buildDshInteractionResumePayload(
        'interaction-1',
        [
          {
            question: '你喜欢哪些水果？',
            header: '水果',
            selectedOptions: ['苹果'],
            otherSelected: false,
            otherText: '',
          },
          {
            question: '你喜欢哪些手机？',
            header: '手机',
            selectedOptions: ['iPhone'],
            otherSelected: true,
            otherText: '小米',
          },
        ],
        [
          { id: 'fruit', question: '你喜欢哪些水果？', header: '水果', options: [], multiSelect: true },
          { id: 'phone', question: '你喜欢哪些手机？', header: '手机', options: [], multiSelect: true },
        ]
      )
    ).toEqual({
      interaction_id: 'interaction-1',
      dshInteraction: {
        source: 'DSH',
        schemaVersion: 1,
        interactionId: 'interaction-1',
        outcome: 'answered',
        answers: [
          { id: 'fruit', selected: ['苹果'] },
          { id: 'phone', selected: ['iPhone'], custom: '小米' },
        ],
      },
    });
  });

  it('does not add recovery fields when the card has no interaction id', () => {
    expect(buildDshInteractionResumePayload(undefined, [], [])).toEqual({});
  });

  it('falls back to the interaction id embedded in the 3014 card', () => {
    expect(resolveDshInteractionId(undefined, ' card-interaction ')).toBe('card-interaction');
    expect(resolveDshInteractionId('metadata-interaction', 'card-interaction')).toBe('metadata-interaction');
  });

  it('keeps the card interaction route when history metadata no longer contains it', () => {
    expect(resolveDshResumeRoute({ parentRunId: undefined, interactionId: undefined }, ' card-interaction ')).toEqual({
      parentRunId: undefined,
      interactionId: 'card-interaction',
    });
  });

  it('recognizes a cold DSH card from its interaction route when sourceAgentType was lost', () => {
    expect(isDshInteractionResume(undefined, 'interaction-1', undefined)).toBe(true);
    expect(isDshInteractionResume('BYCLAW_DSH_u1', 'interaction-1', undefined)).toBe(true);
    expect(isDshInteractionResume(undefined, 'interaction-1', 'run-1')).toBe(false);
  });

  it('recovers the resume trace id embedded in a persisted interaction card', () => {
    expect(resolveResumeTraceId(undefined, { substance: { traceId: ' card-trace ' } })).toBe('card-trace');
    expect(resolveResumeTraceId(' message-trace ', { substance: { traceId: 'card-trace' } })).toBe('message-trace');
  });
});
