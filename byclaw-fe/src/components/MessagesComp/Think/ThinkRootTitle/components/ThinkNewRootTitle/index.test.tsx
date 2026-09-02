import { fireEvent, render, screen } from '@testing-library/react';
import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessage } from '@/typescript/message';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';
import ThinkNewRootTitle from './index';

jest.mock(
  '@/components/MessageList/components/ThinkingProcessRender/components/ThinkingProcessItemRender/index',
  () => ({
    __esModule: true,
    default: ({ thinkListItem }: { thinkListItem: TreeNode }) => (
      <div data-testid={`thinking-node-${thinkListItem.uuid}`} />
    ),
  })
);

jest.mock('@/components/MessageList/lazyHandler', () => ({
  __esModule: true,
  default: {
    lazyComp: () => () => <div data-testid="status-title" />,
  },
}));

const message = {
  creatorId: 'assistant',
  fromBeyond: true,
  msgId: 'message-1',
  messageState: IMessageState.Answer,
  createTime: '',
} as IMessage;

const createTreeNode = (): TreeNode => ({
  uuid: 'root',
  contentType: SSEMessageType.thinkRootTitle,
  status: SSEEventStatus.done,
  orginContent: '',
  content: { substance: 'Root' },
  messageIdx: 0,
  messageLoadingStatus: 1,
  isCollapsed: false,
  shouldOpen: true,
  children: [
    {
      uuid: 'child',
      contentType: SSEMessageType.thinkText,
      status: SSEEventStatus.done,
      orginContent: '',
      content: { substance: 'Child' },
      messageIdx: 1,
      messageLoadingStatus: 1,
      isCollapsed: true,
      children: [],
    },
  ],
});

describe('ThinkNewRootTitle', () => {
  it('collapses a running status title when its status update completes', () => {
    const runningNode: TreeNode = {
      ...createTreeNode(),
      contentType: SSEMessageType.thinkStatusTitle,
      content: {
        substance: { title: '数字员工正在处理', status: '_START_' },
        orderId: 'delegation-1',
      },
      isCollapsed: false,
      shouldOpen: false,
    };
    const { rerender } = render(
      <ThinkNewRootTitle message={message} treeNode={runningNode} updateMessageListItemContent={() => message} />
    );

    expect(screen.getByTestId('thinking-node-child')).toBeInTheDocument();

    rerender(
      <ThinkNewRootTitle
        message={message}
        treeNode={{
          ...runningNode,
          content: {
            ...runningNode.content,
            substance: { title: '数字员工处理完成', status: '_DONE_' },
          },
          isCollapsed: true,
        }}
        updateMessageListItemContent={() => message}
      />
    );

    expect(screen.queryByTestId('thinking-node-child')).not.toBeInTheDocument();
  });

  it('does not allow a branch containing a pending interaction to be collapsed', () => {
    render(
      <ThinkNewRootTitle message={message} treeNode={createTreeNode()} updateMessageListItemContent={() => message} />
    );

    expect(screen.getByTestId('thinking-node-child')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Root'));
    expect(screen.getByTestId('thinking-node-child')).toBeInTheDocument();
  });

  it('reopens a manually collapsed branch when a pending interaction arrives', () => {
    const treeNode = { ...createTreeNode(), shouldOpen: false };
    const { rerender } = render(
      <ThinkNewRootTitle message={message} treeNode={treeNode} updateMessageListItemContent={() => message} />
    );

    fireEvent.click(screen.getByText('Root'));
    expect(screen.queryByTestId('thinking-node-child')).not.toBeInTheDocument();

    rerender(
      <ThinkNewRootTitle
        message={message}
        treeNode={{ ...treeNode, shouldOpen: true }}
        updateMessageListItemContent={() => message}
      />
    );
    expect(screen.getByTestId('thinking-node-child')).toBeInTheDocument();
  });
});
