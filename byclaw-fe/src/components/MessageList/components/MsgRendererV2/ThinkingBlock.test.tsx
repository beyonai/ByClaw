import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import ThinkingBlock from './ThinkingBlock';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/components/MessagesComp/Think/ThinkRootTitle/components/ThinkNewRootTitle', () => ({
  __esModule: true,
  default: ({ treeNode }: { treeNode: IMessageListItem }) => <div data-testid={`thinking-item-${treeNode.uuid}`} />,
}));

const createInteractiveItem = (formStatus: IFormStatus): IMessageListItem => ({
  uuid: 'interactive-item',
  contentType: SSEMessageType.thinkTaskUserInput,
  content: {
    substance: {
      formStatus,
      pluginMachineFields: [],
    },
  },
  status: '_DONE_',
  orginContent: '',
});

const createMessage = (item: IMessageListItem): IMessage =>
  ({
    creatorId: 'assistant',
    fromBeyond: true,
    msgId: 'message-1',
    messageId: 'message-1',
    messageState: IMessageState.Answer,
    createTime: '',
    thinkList: [item],
  } as IMessage);

describe('ThinkingBlock', () => {
  it('keeps an active non-interactive thinking block collapsed by default', () => {
    const item = {
      uuid: 'thinking-item',
      contentType: SSEMessageType.thinkText,
      content: { substance: 'internal reasoning' },
      status: '_START_',
      orginContent: '',
    } as IMessageListItem;

    render(
      <ThinkingBlock
        blockId="think-active"
        items={[item]}
        message={createMessage(item)}
        ended={false}
        updateMessage={(message) => message}
      />
    );

    expect(screen.getByText('thinkingProcess.thinking')).toBeInTheDocument();
    expect(screen.getByText('internal reasoning')).toBeInTheDocument();
    expect(screen.queryByTestId('thinking-item-thinking-item')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('thinkingProcess.thinking'));
    expect(screen.getByTestId('thinking-item-thinking-item')).toBeInTheDocument();
  });

  it('keeps an ended block mounted while it contains a pending EasyConfirm item', () => {
    const item = createInteractiveItem(IFormStatus.INIT);

    render(
      <ThinkingBlock
        blockId="think-1"
        items={[item]}
        message={createMessage(item)}
        ended
        updateMessage={(message) => message}
      />
    );

    expect(screen.getByTestId('thinking-item-interactive-item')).toBeInTheDocument();
  });

  it('updates the collapsed preview while reasoning streams and settles on the first line', () => {
    const item = {
      uuid: 'thinking-item',
      contentType: SSEMessageType.thinkText,
      content: { substance: '先检查上下文\n正在分析第一步' },
      status: '_START_',
      orginContent: '',
    } as IMessageListItem;
    const view = render(
      <ThinkingBlock
        blockId="think-stream"
        items={[item]}
        message={createMessage(item)}
        ended={false}
        updateMessage={(message) => message}
      />
    );

    const summary = screen.getByRole('button', { name: /thinkingProcess.thinking/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveTextContent('正在分析第一步');

    const nextItem = {
      ...item,
      content: { substance: '先检查上下文\n正在分析第二步' },
    } as IMessageListItem;
    view.rerender(
      <ThinkingBlock
        blockId="think-stream"
        items={[nextItem]}
        message={createMessage(nextItem)}
        ended={false}
        updateMessage={(message) => message}
      />
    );
    expect(summary).toHaveTextContent('正在分析第二步');

    view.rerender(
      <ThinkingBlock
        blockId="think-stream"
        items={[nextItem]}
        message={createMessage(nextItem)}
        ended
        updateMessage={(message) => message}
      />
    );
    expect(screen.getByRole('button', { name: /thinkingProcess.done/ })).toHaveTextContent('先检查上下文');
  });

  it('loads the tool call preview from the message component on demand', async () => {
    const item = {
      uuid: 'tool-call-item',
      contentType: SSEMessageType.toolCall,
      content: {
        substance: {
          title: 'Bash',
          description: '检查工作区状态',
        },
      },
      status: '_START_',
      orginContent: '',
    } as IMessageListItem;

    render(
      <ThinkingBlock
        blockId="think-tool-call"
        items={[item]}
        message={createMessage(item)}
        ended={false}
        updateMessage={(message) => message}
      />
    );

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /thinkingProcess.thinking/ })).toHaveTextContent(
          'Bash 检查工作区状态'
        );
      },
      { timeout: 10000 }
    );
  });

  it('allows an ended block to collapse after the interaction is completed', () => {
    const item = createInteractiveItem(IFormStatus.FINISH);

    render(
      <ThinkingBlock
        blockId="think-1"
        items={[item]}
        message={createMessage(item)}
        ended
        updateMessage={(message) => message}
      />
    );

    expect(screen.queryByTestId('thinking-item-interactive-item')).not.toBeInTheDocument();
  });
});
