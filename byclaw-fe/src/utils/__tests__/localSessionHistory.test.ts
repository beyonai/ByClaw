jest.mock('@/utils/messgae', () => ({
  createMessage: (message: any) => ({ creatorId: 'user', ...message }),
}));

import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import { projectLocalHistoryPage } from '../localSessionHistory';

describe('projectLocalHistoryPage', () => {
  it('maps reasoning and tools into the existing v2 renderer channels', () => {
    const list = projectLocalHistoryPage(
      {
        list: [
          { id: 'user-1', role: 'user', createdAt: '2026-01-01T00:00:00.000Z', text: '检查文件' },
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: '2026-01-01T00:00:01.000Z',
            blocks: [
              { type: 'reasoning', text: '先读取', seq: 1 },
              {
                type: 'tool',
                callId: 'call-1',
                name: 'read',
                input: { path: 'a.txt' },
                output: '内容',
                status: 'done',
                seq: 2,
              },
              { type: 'text', text: '完成', seq: 3 },
            ],
          },
        ],
        total: 2,
        pageNum: 1,
        pageSize: 20,
        totalPages: 1,
        hasMore: false,
      },
      'session-1'
    );

    expect(list[0]).toMatchObject({ messageId: 'user-1', text: '检查文件', fromBeyond: false, isHistoryMsg: true });
    expect(list[1].queryMsgId).toBe('user-1');
    expect(list[1].thinkList?.map((item) => item.contentType)).toEqual([
      SSEMessageType.thinkText,
      SSEMessageType.toolCall,
    ]);
    expect(list[1].thinkList?.[1].content.substance).toEqual({
      title: 'read',
      input: { path: 'a.txt' },
      output: '内容',
      status: SSEEventStatus.done,
    });
    expect(list[1].messageList?.[0]).toMatchObject({ contentType: SSEMessageType.text, seq: 3 });
    expect(JSON.parse(list[1].metadata || '{}')).toEqual({ messageRenderVersion: 'v2' });
  });

  it('maps failed tools to the renderer error status', () => {
    const [message] = projectLocalHistoryPage(
      {
        list: [
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: '2026-01-01T00:00:00.000Z',
            blocks: [{ type: 'tool', callId: 'call-1', name: 'bash', status: 'error', seq: 1 }],
          },
        ],
        total: 1,
        pageNum: 1,
        pageSize: 20,
        totalPages: 1,
        hasMore: false,
      },
      'session-1'
    );
    expect((message.thinkList?.[0].content.substance as any).status).toBe('_ERROR_');
  });
});
