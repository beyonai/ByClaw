jest.mock('@/utils/messgae', () => ({
  isTextContentType: jest.fn((contentType?: number | string) => ['1001', '1002'].includes(`${contentType}`)),
}));

jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

import { SSEEventStatus, SSEMessageType } from '@/constants/message';

import { compareStreamId, parseChatStreamMessage } from '../useSseSender/chatStream';
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
        orginContent: 'hello',
        uuid: undefined,
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
        orginContent: JSON.stringify({ taskStepId: 'task-step-1', foo: 'bar' }),
        uuid: undefined,
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

  it('parses and compares redis stream ids for chat stream messages', () => {
    const parsed = parseChatStreamMessage({
      event: 'answerDelta',
      clientRequestId: 'answer-client-1',
      streamId: '1710000000000-2',
      data: JSON.stringify({
        contentType: SSEMessageType.text,
        choices: [{ delta: { content: 'hello' } }],
      }),
    });

    expect(parsed?.clientRequestId).toBe('answer-client-1');
    expect(parsed?.streamId).toBe('1710000000000-2');
    expect(compareStreamId('1710000000000-2', '1710000000000-1')).toBe(1);
    expect(compareStreamId('1710000000000-1', '1710000000000-2')).toBe(-1);
    expect(compareStreamId('1710000000000-2', '1710000000000-2')).toBe(0);
  });

  it('preserves lane metadata from stream metadata JSON', () => {
    const parsed = parseChatStreamMessage({
      event: 'answerDelta',
      data: JSON.stringify({
        contentType: SSEMessageType.text,
        metadata: JSON.stringify({
          clientRequestId: 'q1_a2',
          laneId: 'lane-b',
          turnId: 'turn-1',
          agentId: 'agent-b',
          agentName: 'Agent B',
        }),
        choices: [{ delta: { content: 'hello' } }],
      }),
    });

    expect(parsed?.clientRequestId).toBe('q1_a2');
    expect(parsed?.laneId).toBe('lane-b');
    expect(parsed?.turnId).toBe('turn-1');
    expect(parsed?.agentId).toBe('agent-b');
    expect(parsed?.agentName).toBe('Agent B');
    expect(parsed?.formattedPayload).toMatchObject({
      clientRequestId: 'q1_a2',
      laneId: 'lane-b',
      turnId: 'turn-1',
      agentId: 'agent-b',
      agentName: 'Agent B',
    });
  });

  it('prefers lane clientRequestId from stream data over broadcast wrapper', () => {
    const parsed = parseChatStreamMessage({
      event: 'answerDelta',
      clientRequestId: 'primary-lane-client',
      data: JSON.stringify({
        contentType: SSEMessageType.text,
        clientRequestId: 'lane-b-client',
        laneId: 'lane-b',
        choices: [{ delta: { content: 'hello' } }],
      }),
    });

    expect(parsed?.clientRequestId).toBe('lane-b-client');
    expect(parsed?.laneId).toBe('lane-b');
  });
});
