import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { SSEMessageType, SSEEventStatus } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { loadThinkingPreviewGetter } from '../thinkingPreviewHandler';
import MessagePreview from './index';
import { getPreviewItem } from './preview';

jest.mock('../thinkingPreviewHandler', () => ({ loadThinkingPreviewGetter: jest.fn() }));
const message = { msgId: 'preview', messageId: '42' } as IMessage;
const item = (seq: number, substance: unknown, contentType = SSEMessageType.text): IMessageListItem => ({
  seq,
  contentType,
  content: { substance },
  status: SSEEventStatus.query,
  uuid: String(seq),
  orginContent: '',
});
beforeEach(() => {
  (loadThinkingPreviewGetter as jest.Mock).mockResolvedValue(null);
});

test('shares running/latest and ended/first selection with ThinkingBlock', () => {
  const items = [item(1, '第一行\n第二行'), item(2, '最新一行')];
  expect(getPreviewItem(items, false)).toBe(items[1]);
  expect(getPreviewItem(items, true)).toBe(items[0]);
  const { rerender } = render(<MessagePreview message={message} items={items} />);
  expect(screen.getByText('最新一行')).toBeInTheDocument();
  rerender(<MessagePreview message={message} items={items} ended />);
  expect(screen.getByText('第一行')).toBeInTheDocument();
});

test('uses the contentType getter for object content and ignores a late old getter', async () => {
  let complete!: (getter: any) => void;
  (loadThinkingPreviewGetter as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const { rerender } = render(
    <MessagePreview
      message={message}
      items={[item(1, { title: '旧工具' }, SSEMessageType.toolCall)]}
      fallback="Loading"
    />
  );
  expect(loadThinkingPreviewGetter).toHaveBeenCalledWith(SSEMessageType.toolCall);
  expect(screen.getByText('Loading')).toBeInTheDocument();
  rerender(<MessagePreview message={message} items={[item(2, '新答案')]} />);
  await act(async () => {
    complete(() => '迟到的旧工具');
  });
  expect(screen.getByText('新答案')).toBeInTheDocument();
  expect(screen.queryByText('迟到的旧工具')).not.toBeInTheDocument();
});

test.each(['reasoningLogDelta', 'answerDelta'])('selects the same tool preview for %s', async (eventType) => {
  (loadThinkingPreviewGetter as jest.Mock).mockResolvedValue(
    ({ messageListItemContent }: any) => messageListItemContent.substance.title
  );
  await act(async () => {
    render(
      <MessagePreview
        message={message}
        items={[{ ...item(1, { title: '正在搜索资料' }, SSEMessageType.toolCall), eventType }]}
      />
    );
  });
  expect(screen.getByText('正在搜索资料')).toBeInTheDocument();
});

// Host widths cover narrow and desktop layout contracts; jsdom does not prove real-device overflow behavior.
test.each([360, 1280])('keeps the same preview component in a %ipx host', (width) => {
  const text = '较长的预览内容'.repeat(30);
  const { container } = render(
    <div style={{ width }}>
      <MessagePreview message={message} items={[item(1, text)]} />
    </div>
  );
  const preview = container.querySelector('span[title]');
  expect(preview).not.toBeNull();
  expect(preview?.textContent?.length).toBeLessThanOrEqual(121);
});
