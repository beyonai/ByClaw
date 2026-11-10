import { act, fireEvent, render, screen } from '@testing-library/react';
import { SSEMessageType } from '@/constants/message';
import type { IMessage } from '@/typescript/message';
import type { SandboxInstanceRef } from '@/utils/desktopInstances';
import VNC from '../index';

const mockOpen = jest.fn();
const mockRegister = jest.fn();
const mockSelect = jest.fn();
const mockGetSandboxes = jest.fn();
const mockApp = { getSandboxesInfoUrl: mockGetSandboxes, sandboxesInfo: undefined as unknown };
const runningSandbox = (sandboxId: string, instance = 'vnc') => ({
  sandboxId,
  status: 'RUNNING',
  instanceEndpoints: { [instance]: '/proxy/8081' },
});
const owner = JSON.stringify(['session', 'session']);
let mockWorkspace: { owners: Record<string, any>; pendingOwner: string };
jest.mock('@/hooks/useVncOpener', () => () => mockOpen);
jest.mock('@/models/common/useAppStore', () =>
  Object.assign((select: any) => select(mockApp), { getState: () => mockApp })
);
jest.mock('@/utils/desktopWorkspace', () => ({
  registerDesktops: (...args: any[]) => mockRegister(...args),
  selectDesktop: (...args: any[]) => mockSelect(...args),
  useDesktopWorkspace: (select: any) => select(mockWorkspace),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSandboxes.mockResolvedValue([runningSandbox('a')]);
  mockWorkspace = { owners: {}, pendingOwner: '' };
});

const browserTool = {
  contentType: SSEMessageType.toolCall,
  content: { substance: { title: 'browser', input: { operation: 'navigate' } } },
};
const browserAnswer = {
  sessionId: 'session',
  fromBeyond: true,
  messageList: [browserTool],
} as IMessage;
const referencedAnswer = (instanceRefs: SandboxInstanceRef[]) =>
  ({
    ...browserAnswer,
    messageList: [{ ...browserTool, content: { ...browserTool.content, instanceRefs } }],
  } as IMessage);

test('shows a legacy browser answer with an unambiguous running VNC and without a zero badge', async () => {
  render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
  fireEvent.click(await screen.findByRole('button', { name: /远程桌面$/ }));
  expect(mockSelect).toHaveBeenCalledWith(owner, { sandboxId: 'a', instance: 'vnc' });
  expect(mockOpen).toHaveBeenCalledWith();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

test('shows the button when the latest tool message references a running desktop', async () => {
  const ref = { sandboxId: 'a', instance: 'vnc' };
  const olderAnswer = referencedAnswer([ref]);
  const latestAnswer = referencedAnswer([]);
  const view = render(
    <VNC sessionId="session" latestDigitalEmployeeMessage={latestAnswer} messages={[olderAnswer, latestAnswer]} />
  );
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  expect(mockRegister).toHaveBeenCalledWith(owner, [ref]);

  const updatedAnswer = referencedAnswer([{ sandboxId: 'b', instance: 'desktop' }]);
  mockGetSandboxes.mockResolvedValue([runningSandbox('b', 'desktop')]);
  view.rerender(
    <VNC sessionId="session" latestDigitalEmployeeMessage={updatedAnswer} messages={[olderAnswer, updatedAnswer]} />
  );
  expect(await screen.findByTitle('远程桌面')).toBeInTheDocument();
});

test('offers a manual desktop only for a sandbox execution that requests it', async () => {
  const refs = [{ sandboxId: 'a', instance: 'vnc' }];
  const tool = (title: string, input: unknown) => ({
    ...browserTool,
    content: { instanceRefs: refs, substance: { title, input } },
  });
  const acquire = tool('sandbox_acquire', {});
  const answer = {
    ...browserAnswer,
    messageList: [acquire, tool('sandbox_exec', { argv: ['wecom', 'contact', 'list'] })],
  } as IMessage;
  const view = render(<VNC sessionId="session" latestDigitalEmployeeMessage={answer} />);
  expect(mockGetSandboxes).not.toHaveBeenCalled();

  const requested = {
    ...answer,
    messageList: [acquire, tool('sandbox_exec', '{"opts":{"show_desktop":{}}}')],
  } as IMessage;
  view.rerender(<VNC sessionId="session" latestDigitalEmployeeMessage={requested} />);
  fireEvent.click(await screen.findByTitle('远程桌面'));
  expect(mockSelect).toHaveBeenCalledWith(owner, refs[0]);
  expect(mockOpen).toHaveBeenCalledWith();
});

test.each([
  { ...runningSandbox('a'), status: 'STOPPED' },
  { ...runningSandbox('a'), instanceEndpoints: {} },
  { ...runningSandbox('a'), instanceDescriptors: { vnc: { viewer: 'web' } } },
  { ...runningSandbox('a'), isShared: true, mappingId: 'other-mapping' },
])('hides the entry when the referenced desktop is unavailable (%j)', async (row) => {
  mockGetSandboxes.mockResolvedValue([row, runningSandbox('unrelated')]);
  await act(async () => {
    render(
      <VNC sessionId="session" latestDigitalEmployeeMessage={referencedAnswer([{ sandboxId: 'a', instance: 'vnc' }])} />
    );
  });
  expect(mockGetSandboxes).toHaveBeenCalled();
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
});

test('hides a legacy browser answer when more than one running VNC could belong to it', async () => {
  mockGetSandboxes.mockResolvedValue([runningSandbox('a'), runningSandbox('b')]);
  await act(async () => {
    render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
  });
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
});

test('hides the button when the sandbox stops after it was shown', async () => {
  jest.useFakeTimers();
  try {
    await act(async () => {
      render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
    });
    expect(screen.getByTitle('远程桌面')).toBeInTheDocument();
    mockGetSandboxes.mockResolvedValue([{ ...runningSandbox('a'), status: 'STOPPED' }]);
    await act(async () => jest.advanceTimersByTime(10000));
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('shows a separate badge counting only visible desktop instances', async () => {
  mockWorkspace.owners[owner] = {
    refs: [
      { sandboxId: 'a', instance: 'vnc' },
      { sandboxId: 'b', instance: 'vnc' },
    ],
    hidden: [JSON.stringify(['b', null, 'vnc'])],
  };
  render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
  expect(await screen.findByText('1', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 1' })).toBeInTheDocument();
});

test('caps the visual badge while keeping the actual count accessible', async () => {
  mockWorkspace.owners[owner] = {
    refs: Array.from({ length: 103 }, (_, index) => ({ sandboxId: `sb-${index}`, instance: 'vnc' })),
    hidden: [],
  };
  render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
  expect(await screen.findByText('99+')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 103' })).toBeInTheDocument();
});

test('keeps the preparing state accessible alongside the count', async () => {
  mockWorkspace.owners[owner] = { refs: [{ sandboxId: 'a', instance: 'vnc' }], hidden: [] };
  mockWorkspace.pendingOwner = owner;
  render(<VNC sessionId="session" latestDigitalEmployeeMessage={browserAnswer} />);
  expect(await screen.findByText('1', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 1 · 正在准备' })).toBeInTheDocument();
});
