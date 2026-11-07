import { fireEvent, render, screen } from '@testing-library/react';
import VNC from '../index';

const mockOpen = jest.fn();
const mockRegister = jest.fn();
const owner = JSON.stringify(['session', 'session']);
let mockWorkspace: { owners: Record<string, any>; pendingOwner: string };
jest.mock('@/hooks/useVncOpener', () => () => mockOpen);
jest.mock('@/utils/desktopWorkspace', () => ({
  registerDesktops: (...args: any[]) => mockRegister(...args),
  useDesktopWorkspace: (select: any) => select(mockWorkspace),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkspace = { owners: {}, pendingOwner: '' };
});

test('keeps the zero-instance desktop entry available without a zero badge', () => {
  render(<VNC sessionId="session" />);
  fireEvent.click(screen.getByRole('button', { name: /远程桌面$/ }));
  expect(mockOpen).toHaveBeenCalledWith();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

test('shows a separate badge counting only visible desktop instances', () => {
  mockWorkspace.owners[owner] = {
    refs: [
      { sandboxId: 'a', instance: 'vnc' },
      { sandboxId: 'b', instance: 'vnc' },
    ],
    hidden: [JSON.stringify(['b', null, 'vnc'])],
  };
  render(<VNC sessionId="session" />);
  expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 1' })).toBeInTheDocument();
});

test('caps the visual badge while keeping the actual count accessible', () => {
  mockWorkspace.owners[owner] = {
    refs: Array.from({ length: 103 }, (_, index) => ({ sandboxId: `sb-${index}`, instance: 'vnc' })),
    hidden: [],
  };
  render(<VNC sessionId="session" />);
  expect(screen.getByText('99+')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 103' })).toBeInTheDocument();
});

test('keeps the preparing state accessible alongside the count', () => {
  mockWorkspace.owners[owner] = { refs: [{ sandboxId: 'a', instance: 'vnc' }], hidden: [] };
  mockWorkspace.pendingOwner = owner;
  render(<VNC sessionId="session" />);
  expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '远程桌面 1 · 正在准备' })).toBeInTheDocument();
});
