import { fireEvent, render, screen } from '@testing-library/react';

import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

import useRender from './useRender';

const mockEmit = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useDispatch: () => jest.fn(),
  useNavigate: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ user: { userInfo: { userId: 'user-1' } }, employees: { employeesList: [], agentList: [] } }),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: mockEmit } }),
}));
jest.mock('@/hooks/useModal', () => ({
  __esModule: true,
  default: () => ({ ModalNode: null, setOpen: jest.fn(), setMyContent: jest.fn(), setMyTitle: jest.fn() }),
}));
jest.mock('@/hooks/useVoicePreferences', () => ({
  __esModule: true,
  default: () => ({ autoPlay: false, autoTranscribe: false }),
}));
jest.mock('@/components/ChatLayoutComp/components/MultiChoices/hooks/useCanRefrence', () => ({
  __esModule: true,
  default: () => ({ canRefrence: false }),
}));

// 隔离消息内容与其它操作，验证真实消息渲染器中的分享入口及多选事件衔接。
jest.mock('@/pages/digitalEmployees', () => ({ EmployeePreviewModal: () => null }));
jest.mock('@/components/Loading/DualBallLoading', () => () => null);
jest.mock('@/components/Loading/WaveBallLoading', () => () => null);
jest.mock('@/components/MessageList/components/CiteRender', () => () => null);
jest.mock('@/components/MessageList/components/FileRender', () => () => null);
jest.mock('@/components/MessageList/components/ReplyFileArtifacts', () => () => null);
jest.mock('@/components/NotSupport', () => () => null);
jest.mock('./components/AnswerActions/ThumbUp/content', () => () => null);
jest.mock('./components/AnswerActions/Copy', () => () => null);
jest.mock('./components/AnswerActions/MoreActions', () => () => null);
jest.mock('./components/AnswerActions/ThumbUp', () => () => null);
jest.mock('./components/MsgRenderer', () => () => null);
jest.mock('./components/UsedModelBadge', () => () => null);
jest.mock('./components/MsgRendererV2', () => () => null);
jest.mock('./components/MsgRendererV2/ordered', () => ({ isV2Message: () => true }));
jest.mock('./components/VoiceMessage', () => () => null);
jest.mock('./components/MsgRendererV2/FinalAnswerLayout', () => () => null);
jest.mock('./components/MsgRendererV2/ConnectorAuthorizationActions', () => () => null);
jest.mock('@/components/OrgUserSelector/components/UserInfoModal', () => () => null);
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('./lazyHandler', () => ({ __esModule: true, default: { lazyComp: () => null } }));
jest.mock('@/utils', () => ({ getPublicPath: () => '/' }));
jest.mock('@/utils/agent', () => ({ getAgentChatAvatar: () => null }));
jest.mock('@/utils/employeeChat', () => ({ navigateToEmployeeChat: jest.fn() }));
jest.mock('@/utils/voice', () => ({ getVoiceMessage: () => undefined }));
jest.mock('@/utils/system', () => ({ getSystemConfigByStorage: () => ({ title: 'AI' }) }));
jest.mock('@/utils/chat', () => ({ getDisplayUserNameInChat: (name: string) => name }));
jest.mock('@/components/QueryInput/RichInput/utils/constants', () => ({ ResourceType: {} }));
jest.mock('../QueryInput/getDisplayQuestion', () => () => 'question');
jest.mock('../QueryInput/getDisplayAnswer', () => () => 'answer');
jest.mock('./utils', () => ({
  getResponseAgentInfoByMessage: () => null,
  getDigitalEmployeeMentionItem: () => null,
  getDisplayDateTime: () => '',
}));

type HarnessProps = {
  messageState: IMessageState;
  fromBeyond?: boolean;
  hideAction?: boolean;
};

function MessageShareHarness({ messageState, fromBeyond = true, hideAction = false }: HarnessProps) {
  const { renderMessage } = useRender({
    updateMessage: (message) => message,
    deleteMessage: jest.fn(),
  });
  const message = {
    messageState,
    fromBeyond,
    msgId: 'message-1',
    messageList: [],
  } as IMessage;

  return renderMessage(message, { hideAction });
}

describe('消息分享入口', () => {
  beforeEach(() => {
    mockEmit.mockClear();
  });

  it.each([IMessageState.Done, IMessageState.Cancel])('状态 %s 的回答可分享，并先选中当前消息', (messageState) => {
    render(<MessageShareHarness messageState={messageState} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.share' }));

    expect(mockEmit.mock.calls).toEqual([
      ['beyond-messageList-set-multichoices-msgid', ['message-1']],
      ['beyond-messageList-open-multichoices', ['shared']],
    ]);
  });

  it.each([IMessageState.Query, IMessageState.Answer, IMessageState.Error, IMessageState.Timeout])(
    '状态 %s 的回答不显示分享入口',
    (messageState) => {
      render(<MessageShareHarness messageState={messageState} />);

      expect(screen.queryByRole('button', { name: 'common.share' })).not.toBeInTheDocument();
      expect(mockEmit).not.toHaveBeenCalled();
    }
  );

  it('隐藏操作栏时不显示分享入口', () => {
    render(<MessageShareHarness messageState={IMessageState.Done} hideAction />);

    expect(screen.queryByRole('button', { name: 'common.share' })).not.toBeInTheDocument();
  });

  it('用户提问仍保留原有操作范围', () => {
    render(<MessageShareHarness messageState={IMessageState.Done} fromBeyond={false} />);

    expect(screen.queryByRole('button', { name: 'common.share' })).not.toBeInTheDocument();
  });
});
