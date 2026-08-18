jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/messgae', () => ({
  initAnswerMessage: jest.fn((value: any) => ({ ...value, initialized: 'answer' })),
  initQueryMessage: jest.fn((value: any) => ({ ...value, initialized: 'query' })),
  isTextContentType: jest.fn((type: string | number) => [`1002`, `1001`].includes(`${type}`)),
}));

jest.mock('../useChat/util', () => ({
  substanceHandler: jest.fn((message: any, last: any) => {
    if (last) {
      last.content.substance = `${last.content.substance}${message.content.substance}`;
      return undefined;
    }
    return message;
  }),
}));

import { renderHook } from '@testing-library/react';
import { useDispatch, useSelector } from '@umijs/max';
import useGlobal from '../useGlobal';
import useHandler from '../useChat/useHandler';
import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useChat/useHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDispatch.mockReturnValue(jest.fn());
    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        employees: {
          employees: [],
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      EventEmitter: { emit: jest.fn() },
      agentInfo: { resourceCode: 'agent-code' },
      sessionId: '',
      setSessionId: jest.fn(),
    } as any);
  });

  it('sessionInfoHandler writes session ext params, adds session and updates current ids', () => {
    const dispatch = mockUseDispatch.mock.results[0]?.value || mockUseDispatch();
    const addSession = jest.fn();
    const setSessionId = jest.fn();

    const { result } = renderHook(() => useHandler({ addSession, setSessionId }));

    const onionsProps = {
      sseRes: {
        sessionId: 's1',
        sessionExts: [{ extParamCode: 'k', extParamValue: 'v' }],
      },
      sseMsg: { event: 'createSession' },
      newQueryMsg: {},
      newAnswerMsg: {},
      messageList: [],
    } as any;

    const next = result.current.sessionInfoHandler(onionsProps);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/saveExtParamsBySessionId',
      payload: {
        sessionId: 's1',
        extParams: { k: 'v' },
      },
    });
    expect(addSession).toHaveBeenCalledWith({
      sessionId: 's1',
      sessionExts: [{ extParamCode: 'k', extParamValue: 'v' }],
    });
    expect(setSessionId).toHaveBeenCalledWith('s1');
    expect(next.newQueryMsg.sessionId).toBe('s1');
    expect(next.newAnswerMsg.sessionId).toBe('s1');
  });

  it('sessionInfoHandler updates an existing session title without adding another session', () => {
    const dispatch = mockUseDispatch.mock.results[0]?.value || mockUseDispatch();
    const addSession = jest.fn();
    const { result } = renderHook(() => useHandler({ addSession, setSessionId: jest.fn() }));

    result.current.sessionInfoHandler({
      sseRes: {
        sessionId: 's1',
        sessionName: '第一条用户文字',
        updateTime: '2026-08-11 14:30:25',
      },
      sseMsg: { event: 'sessionTitleUpdated' },
      newQueryMsg: {},
      newAnswerMsg: {},
      messageList: [],
    } as any);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/updateSession',
      payload: {
        sessionId: 's1',
        sessionName: '第一条用户文字',
        updateTime: '2026-08-11 14:30:25',
      },
    });
    expect(addSession).not.toHaveBeenCalled();
  });

  it('messageIdHandler initializes answer/query messages on initMessage', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));

    const answerProps = result.current.messageIdHandler({
      sseRes: { messageId: 'm1' },
      sseMsg: { event: 'initMessage' },
      newAnswerMsg: { messageId: 'm1' },
      newQueryMsg: {},
    } as any);
    expect(answerProps.newAnswerMsg.initialized).toBe('answer');

    const queryProps = result.current.messageIdHandler({
      sseRes: { messageId: 'm2' },
      sseMsg: { event: 'initMessage' },
      newAnswerMsg: {},
      newQueryMsg: { messageId: 'm2' },
    } as any);
    expect(queryProps.newQueryMsg.initialized).toBe('query');
  });

  it('queryMessageIdHandler and resComIdsHandler assign ids directly', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const onionsProps = {
      sseRes: { queryMessageId: 'q1', resComIds: ['r1'] },
      newQueryMsg: {},
      newAnswerMsg: {},
    } as any;

    result.current.queryMessageIdHandler(onionsProps);
    result.current.resComIdsHandler(onionsProps);

    expect(onionsProps.newQueryMsg.messageId).toBe('q1');
    expect(onionsProps.newAnswerMsg.resComIds).toEqual(['r1']);
  });

  it('textHandler appends think text and marks thinkDone on done status', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const onionsProps = {
      sseRes: {
        message: {
          contentType: SSEMessageType.thinkText,
          status: SSEEventStatus.done,
          content: { substance: 'hello' },
        },
      },
      sseMsg: { event: 'reasoningLogEnd' },
      newAnswerMsg: {
        thinkList: [],
      },
    } as any;

    result.current.textHandler(onionsProps);

    expect(onionsProps.newAnswerMsg.thinkList).toHaveLength(1);
    expect(onionsProps.newAnswerMsg.thinkDone).toBe(true);
  });

  it('marks a v2 answer as streaming when the first reasoning text arrives', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const onionsProps = {
      sseRes: {
        metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
        message: {
          contentType: SSEMessageType.thinkText,
          status: SSEEventStatus.start,
          content: { substance: 'thinking' },
        },
      },
      sseMsg: { event: 'reasoningLogDelta' },
      newAnswerMsg: {
        messageState: IMessageState.Query,
        thinkList: [],
      },
    } as any;

    result.current.textHandler(onionsProps);

    expect(onionsProps.newAnswerMsg.messageState).toBe(IMessageState.Answer);
    expect(onionsProps.newAnswerMsg.thinkDone).toBe(false);
  });

  it('processes a v2 non-text reasoning chunk only once across the handler pipeline', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const title = '周伯通的超级助手 智能体已就绪';
    const onionsProps = {
      sseRes: {
        metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
        message: {
          contentType: SSEMessageType.thinkTitle,
          status: SSEEventStatus.query,
          content: {
            orderId: 'ready',
            parentOrderId: '-1',
            substance: title,
          },
        },
      },
      sseMsg: { event: 'reasoningLogDelta' },
      newAnswerMsg: {
        messageState: IMessageState.Query,
        thinkList: [],
      },
    } as any;

    result.current.textHandler(onionsProps);
    result.current.messageHandler(onionsProps);

    expect(onionsProps.newAnswerMsg.thinkList).toHaveLength(1);
    expect(onionsProps.newAnswerMsg.thinkList[0].content.substance).toBe(title);
  });

  it('continues the last restored v2 segment without mutating the existing list reference', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const originalThinkList = [
      {
        seq: 3,
        eventType: 'reasoningLogDelta',
        contentType: SSEMessageType.thinkText,
        status: SSEEventStatus.query,
        content: { orderId: 'reasoning', parentOrderId: '-1', substance: '已有' },
      },
    ];
    const newAnswerMsg = {
      metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
      messageState: IMessageState.Answer,
      thinkDone: true,
      thinkList: originalThinkList,
      messageList: [],
    } as any;
    const onionsProps = {
      sseRes: {
        message: {
          seq: 3,
          eventType: 'reasoningLogDelta',
          contentType: SSEMessageType.thinkText,
          status: SSEEventStatus.query,
          content: { orderId: 'reasoning', parentOrderId: '-1', substance: '增量' },
        },
      },
      sseMsg: { event: 'reasoningLogDelta' },
      newAnswerMsg,
    } as any;

    result.current.textHandler(onionsProps);

    expect(newAnswerMsg.thinkList).not.toBe(originalThinkList);
    expect(newAnswerMsg.thinkList).toHaveLength(1);
    expect(newAnswerMsg.thinkList[0].seq).toBe(3);
    expect(newAnswerMsg.thinkList[0].content.substance).toBe('已有增量');
    expect(newAnswerMsg._v2NextSeq).toBe(4);
    expect(newAnswerMsg.thinkDone).toBe(false);
  });

  it('ends the active v2 thinking block when reasoning ends', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const onionsProps = {
      sseRes: {
        metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
      },
      sseMsg: { event: 'reasoningLogEnd' },
      newAnswerMsg: {
        messageState: IMessageState.Answer,
        thinkDone: false,
        thinkList: [],
      },
    } as any;

    result.current.textHandler(onionsProps);

    expect(onionsProps.newAnswerMsg.thinkDone).toBe(true);
  });

  it('rewriteQuestionHandler hides and marks answer for deletion on rewriteQuestion', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const onionsProps = {
      sseRes: {
        message: {
          contentType: SSEMessageType.rewriteQuestion,
          content: { substance: JSON.stringify({ value: 1 }) },
        },
      },
      newAnswerMsg: {},
    } as any;

    result.current.rewriteQuestionHandler(onionsProps);

    expect(onionsProps.newAnswerMsg.isHide).toBe(true);
    expect(onionsProps.newAnswerMsg.shouldDelete).toBe(true);
  });
});
