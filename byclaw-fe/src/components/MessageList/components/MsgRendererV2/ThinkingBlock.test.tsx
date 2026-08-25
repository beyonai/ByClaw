import { render, screen } from '@testing-library/react';
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
