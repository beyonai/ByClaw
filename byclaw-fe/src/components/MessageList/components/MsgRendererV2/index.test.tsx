import { fireEvent, render, screen } from '@testing-library/react';
import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { CONNECTOR_AUTHORIZATION_REQUEST_EVENT } from '@/utils/connectorAuthorization';
import MsgRendererV2 from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => (id === 'message.taskEnded' ? '任务已结束' : id),
  }),
}));

jest.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <p>{text}</p>,
}));

jest.mock('@/components/MessageList/lazyHandler', () => {
  const Text = ({ messageListItem }: { messageListItem: IMessageListItem }) => (
    <div>{`${messageListItem.content.substance}`}</div>
  );
  return { __esModule: true, default: { lazyComp: () => Text } };
});

jest.mock('@/components/MessageList/components/MsgRenderer', () => ({
  __esModule: true,
  default: () => <div>legacy process</div>,
}));

const item = (seq: number, substance: string, contentType = SSEMessageType.text): IMessageListItem => ({
  seq,
  contentType,
  content: { substance },
  status: SSEEventStatus.done,
  uuid: `item-${seq}`,
  orginContent: '',
});

const message = (fields: Partial<IMessage> = {}): IMessage => ({
  msgId: 'answer-1',
  creatorId: 'assistant',
  createTime: '1',
  fromBeyond: true,
  messageState: IMessageState.Answer,
  metadata: '{"messageRenderVersion":"v2"}',
  thinkList: [item(1, '思考片段', SSEMessageType.thinkText)],
  messageList: [item(2, '过程答复')],
  ...fields,
});

describe('MsgRendererV2 final answer presentation', () => {
  it('inserts a flat summary on final arrival and retains process nodes when toggled', () => {
    const msg = message({
      thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '继续分析', SSEMessageType.thinkText)],
      messageList: [item(2, '过程答复'), item(4, '后续答复')],
    });
    const view = render(<MsgRendererV2 msg={msg} updateMessage={(value) => value} />);
    const process = screen.getByText('过程答复');
    expect(screen.queryByRole('button', { name: '任务已结束' })).not.toBeInTheDocument();

    view.rerender(<MsgRendererV2 msg={{ ...msg, finalContent: '最终答复' }} updateMessage={(value) => value} />);
    const summary = screen.getByRole('button', { name: '任务已结束' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('过程答复')).toBe(process);
    expect(summary.parentElement).toBe(process.parentElement);
    expect(screen.getByText('最终答复').parentElement?.parentElement).toBe(summary.parentElement);

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    view.rerender(
      <MsgRendererV2
        msg={{ ...msg, finalContent: '最终答复', messageState: IMessageState.Done }}
        updateMessage={(value) => value}
      />
    );
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('过程答复')).toBe(process);
  });

  it.each([IMessageState.Answer, IMessageState.Done, IMessageState.Error])(
    'keeps the original thinking control after a single channel switch in state %s',
    (state) => {
      const msg = message({
        finalContent: '最终答复',
        messageState: state,
        thinkList: [item(2, '思考片段', SSEMessageType.thinkText), item(1, '开始分析', SSEMessageType.thinkText)],
        messageList: [item(4, '最终答复'), item(3, '过程答复')],
      });
      render(<MsgRendererV2 msg={msg} updateMessage={(value) => value} />);

      expect(screen.queryByRole('button', { name: '任务已结束' })).not.toBeInTheDocument();
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /thinkingProcess.done/ })).toBeInTheDocument();
      expect(screen.getByText('过程答复')).toBeInTheDocument();
      expect(screen.getAllByText('最终答复')).toHaveLength(1);
      expect(msg.messageList?.map(({ seq }) => seq)).toEqual([4, 3]);
    }
  );

  it.each([IMessageState.Done, IMessageState.Error])(
    'shows final-only history without an empty summary in state %s',
    (state) => {
      render(
        <MsgRendererV2
          msg={message({ thinkList: [], messageList: [], finalContent: '最终答复', messageState: state })}
          updateMessage={(value) => value}
        />
      );
      expect(screen.queryByRole('button', { name: '任务已结束' })).not.toBeInTheDocument();
      expect(screen.getByText('最终答复')).toBeInTheDocument();
    }
  );

  it('renders matching trailing text once even when the process is expanded', () => {
    const msg = message({
      finalContent: '最终答复',
      thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '继续分析', SSEMessageType.thinkText)],
      messageList: [item(2, '过程答复'), item(4, '最终答复')],
    });
    render(<MsgRendererV2 msg={msg} updateMessage={(value) => value} />);
    fireEvent.click(screen.getByRole('button', { name: '任务已结束' }));

    expect(screen.getAllByText('最终答复')).toHaveLength(1);
    expect(screen.getByText('过程答复')).toBeInTheDocument();
    expect(msg.messageList).toHaveLength(2);
  });

  it('deduplicates a final body split over adjacent trailing text segments', () => {
    render(
      <MsgRendererV2
        msg={message({
          finalContent: '最终答复',
          thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '继续分析', SSEMessageType.thinkText)],
          messageList: [item(2, '过程答复'), item(4, '最终'), item(5, '答复')],
        })}
        updateMessage={(value) => value}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '任务已结束' }));
    expect(screen.queryByText('最终')).not.toBeInTheDocument();
    expect(screen.queryByText('答复')).not.toBeInTheDocument();
    expect(screen.getByText('最终答复')).toBeInTheDocument();
  });

  it('keeps nonmatching text, middle repetitions and structured cards in the process', () => {
    render(
      <MsgRendererV2
        msg={message({
          finalContent: '最终答复',
          messageList: [item(2, '最终答复'), item(3, '卡片', SSEMessageType.commonCard), item(4, '不同答复')],
        })}
        updateMessage={(value) => value}
      />
    );
    expect(screen.queryByRole('button', { name: '任务已结束' })).not.toBeInTheDocument();
    expect(screen.getAllByText('最终答复')).toHaveLength(2);
    expect(screen.getByText('卡片')).toBeInTheDocument();
    expect(screen.getByText('不同答复')).toBeInTheDocument();
  });

  it('does not concatenate text across an intervening chronological thinking block', () => {
    render(
      <MsgRendererV2
        msg={message({
          finalContent: '最终答复',
          thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '继续分析', SSEMessageType.thinkText)],
          messageList: [item(2, '最终'), item(4, '答复')],
        })}
        updateMessage={(value) => value}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '任务已结束' }));
    expect(screen.getByText('最终')).toBeInTheDocument();
    expect(screen.getByText('答复')).toBeInTheDocument();
    expect(screen.getByText('最终答复')).toBeInTheDocument();
  });

  it('deduplicates the last answer even when more thinking follows it', () => {
    render(
      <MsgRendererV2
        msg={message({
          finalContent: '最终答复',
          thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '收尾思考', SSEMessageType.thinkText)],
          messageList: [item(2, '最终答复')],
        })}
        updateMessage={(value) => value}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '任务已结束' }));
    expect(screen.getAllByText('最终答复')).toHaveLength(1);
    expect(screen.getByText('收尾思考')).toBeInTheDocument();
  });

  it('checks chronological boundaries without changing an unsorted source answer list', () => {
    const msg = message({
      finalContent: '最终答复',
      thinkList: [item(1, '开始分析', SSEMessageType.thinkText), item(3, '继续分析', SSEMessageType.thinkText)],
      messageList: [item(4, '最终'), item(2, '答复')],
    });
    Object.freeze(msg.messageList);
    render(<MsgRendererV2 msg={msg} updateMessage={(value) => value} />);
    fireEvent.click(screen.getByRole('button', { name: '任务已结束' }));

    expect(screen.getByText('最终')).toBeInTheDocument();
    expect(screen.getByText('答复')).toBeInTheDocument();
    expect(msg.messageList?.map(({ seq }) => seq)).toEqual([4, 2]);
  });

  it('still renders the final body when ordered process data requires a legacy fallback', () => {
    render(
      <MsgRendererV2
        msg={message({ finalContent: '最终答复', messageList: [{ ...item(2, 'legacy'), seq: undefined }] })}
        updateMessage={(value) => value}
      />
    );
    expect(screen.getByText('legacy process')).toBeInTheDocument();
    expect(screen.getByText('最终答复')).toBeInTheDocument();
  });

  it('keeps the existing rendering when a completed message has no valid final content', () => {
    render(
      <MsgRendererV2
        msg={message({ messageState: IMessageState.Done, finalContent: '  ' })}
        updateMessage={(value) => value}
      />
    );
    expect(screen.queryByRole('button', { name: '任务已结束' })).not.toBeInTheDocument();
    expect(screen.getByText('过程答复')).toBeInTheDocument();
  });

  it('renders deduplicated connector actions after the complete conversation content', () => {
    const connectorError = (seq: number, connectorCode: string): IMessageListItem => ({
      ...item(seq, '', SSEMessageType.toolCall),
      content: {
        substance: {
          title: 'media_tool',
          output: `Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=${connectorCode}; 请配置连接器。`,
          status: '_ERROR_',
        },
      },
    });
    const listener = jest.fn();
    window.addEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, listener);

    render(
      <MsgRendererV2
        msg={message({
          messageState: IMessageState.Error,
          thinkList: [
            connectorError(1, 'image-generation-model'),
            connectorError(2, 'image-generation-model'),
            connectorError(3, 'speech-generation-model'),
          ],
          messageList: [item(4, '最后一条对话内容')],
        })}
        updateMessage={(value) => value}
      />
    );

    expect(screen.getAllByRole('button', { name: '配置文生图模型连接器' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '配置语音模型连接器' })).toHaveLength(1);
    const conversation = screen.getByText('最后一条对话内容');
    const actions = screen.getByRole('group', { name: '需要配置的连接器' });
    expect(conversation.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '配置文生图模型连接器' }));
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ connectorCode: 'image-generation-model' });
    window.removeEventListener(CONNECTOR_AUTHORIZATION_REQUEST_EVENT, listener);
  });

  it('waits until the conversation turn ends before showing connector actions', () => {
    render(
      <MsgRendererV2
        msg={message({
          messageState: IMessageState.Answer,
          thinkList: [
            {
              ...item(1, '', SSEMessageType.toolCall),
              content: {
                substance: {
                  output:
                    'Error: MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=image-generation-model; 请配置连接器。',
                },
              },
            },
          ],
        })}
        updateMessage={(value) => value}
      />
    );

    expect(screen.queryByRole('group', { name: '需要配置的连接器' })).not.toBeInTheDocument();
  });
});
