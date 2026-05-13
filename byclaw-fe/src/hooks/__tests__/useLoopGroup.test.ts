jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
}));

jest.mock('@/models/useMessageStore', () => ({
  fetchMessage: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useDispatch } from '@umijs/max';
import { fetchMessage } from '@/models/useMessageStore';

import useLoopGroup from '../useChat/useLoopGroup';

const mockUseDispatch = useDispatch as jest.Mock;
const mockFetchMessage = fetchMessage as jest.MockedFunction<typeof fetchMessage>;

describe('hooks/useChat/useLoopGroup', () => {
  let dispatch: jest.Mock;
  let messageList: any[];
  let setMessageList: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    dispatch = jest.fn();
    messageList = [{ messageId: '2', text: 'old' }];
    setMessageList = jest.fn((next) => {
      messageList = next;
    });
    mockUseDispatch.mockReturnValue(dispatch);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls new messages and merges them into current state', async () => {
    mockFetchMessage.mockResolvedValue({
      list: [{ messageId: '1', text: 'new' }],
      total: 2,
    } as any);

    const { result } = renderHook(() =>
      useLoopGroup({
        getMessageList: () => messageList as any,
        setMessageList: setMessageList as any,
      })
    );

    act(() => {
      result.current.startLooping('session-1');
      jest.advanceTimersByTime(5000);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fromMessageId: '2',
      streamAppend: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageStore/setSessionMessage',
      payload: {
        sessionId: 'session-1',
        messageListInfo: {
          list: [
            { messageId: '1', text: 'new' },
            { messageId: '2', text: 'old' },
          ],
          total: 2,
        },
      },
    });
    expect(setMessageList).toHaveBeenCalledWith([
      { messageId: '1', text: 'new' },
      { messageId: '2', text: 'old' },
    ]);
  });

  it('stops polling when stopLooping is called', () => {
    const { result } = renderHook(() =>
      useLoopGroup({
        getMessageList: () => messageList as any,
        setMessageList: setMessageList as any,
      })
    );

    act(() => {
      result.current.startLooping('session-1');
      result.current.stopLooping();
      jest.advanceTimersByTime(10000);
    });

    expect(mockFetchMessage).not.toHaveBeenCalled();
  });
});
