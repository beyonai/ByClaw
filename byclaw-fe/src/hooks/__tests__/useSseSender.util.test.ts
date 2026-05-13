jest.mock('@/utils/messgae', () => ({
  isTextContentType: jest.fn((contentType?: number | string) => ['1001', '1002'].includes(`${contentType}`)),
}));

import { SSEEventStatus, SSEMessageType } from '@/constants/message';

import { answerDeltaHandler, reasoningLogHandler, resComIdsHandler } from '../useSseSender/util';

describe('hooks/useSseSender/util', () => {
  it('formats text answer deltas and preserves message metadata', () => {
    expect(
      answerDeltaHandler(
        {
          contentType: SSEMessageType.text,
          objectType: 'AGENT',
          agentId: 'agent-1',
          choices: [{ delta: { content: 'hello' } }],
        },
        'answerDelta'
      )
    ).toEqual({
      message: {
        contentType: SSEMessageType.text,
        content: {
          substance: 'hello',
        },
        status: SSEEventStatus.query,
        objectType: 'AGENT',
        agentId: 'agent-1',
      },
    });
  });

  it('parses think-task user input payloads and derives stepId from JSON content', () => {
    expect(
      answerDeltaHandler({
        contentType: SSEMessageType.thinkTaskUserInput,
        sourceAgentType: '013',
        choices: [{ delta: { content: JSON.stringify({ taskStepId: 'task-step-1', foo: 'bar' }) } }],
      })
    ).toEqual({
      message: {
        contentType: SSEMessageType.thinkTaskUserInput,
        content: {
          substance: {
            taskStepId: 'task-step-1',
            foo: 'bar',
          },
          stepId: 'task-step-1',
          sourceAgentType: '013',
        },
        status: SSEEventStatus.done,
        objectType: undefined,
        agentId: undefined,
      },
    });
  });

  it('marks reasoning logs done when text content is already JSON', () => {
    const result = reasoningLogHandler(
      {
        contentType: SSEMessageType.text,
        choices: [{ delta: { content: JSON.stringify({ complete: true }) } }],
      },
      'reasoningLogDelta'
    );

    expect(result.message).toMatchObject({
      contentType: `${SSEMessageType.thinkText}`,
      status: SSEEventStatus.done,
      content: {
        substance: JSON.stringify({ complete: true }),
      },
    });
  });

  it('builds resource completion ids payloads', () => {
    expect(resComIdsHandler('res-1', SSEMessageType.text)).toEqual({
      contentType: SSEMessageType.text,
      content: { resComId: 'res-1' },
      status: SSEEventStatus.done,
    });
    expect(resComIdsHandler('', SSEMessageType.text)).toBeNull();
  });
});
