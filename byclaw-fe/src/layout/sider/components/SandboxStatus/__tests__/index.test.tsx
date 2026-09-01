import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SandboxStatusIndicator from '../index';
import useSandboxStatus from '../useSandboxStatus';

const mockRestartSandbox = jest.fn();

jest.mock('../useSandboxStatus');

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      values?.sandboxType ? `${id}:${values.sandboxType}` : id,
  }),
}));

jest.mock('antd', () => ({
  Dropdown: ({ menu, children }: any) => (
    <div>
      {children}
      <div>
        {(menu.items || []).map((item: any) => (
          <button key={item.key} type="button" disabled={item.disabled} onClick={item.onClick}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ),
  Tooltip: ({ children }: any) => children,
  Modal: ({ open, title, children, onOk, okText }: any) =>
    open ? (
      <div>
        <div>{title}</div>
        <div>{children}</div>
        <button type="button" onClick={onOk}>
          {okText}
        </button>
      </div>
    ) : null,
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('SandboxStatusIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSandboxStatus as jest.Mock).mockReturnValue({
      status: 'running',
      sandboxes: [
        { userCode: 'user001', sandboxType: 'openclaw', sandboxId: 'sandbox-1', status: 'RUNNING' },
        { userCode: 'user001', sandboxType: 'byclaw-dsh', sandboxId: 'sandbox-2', status: 'STARTING' },
      ],
      refetch: jest.fn(),
      restartSandbox: mockRestartSandbox.mockResolvedValue(undefined),
    });
  });

  it('lists every sandbox service and restarts only the selected service', async () => {
    render(<SandboxStatusIndicator userCode="user001" />);

    expect(screen.getByText('openclaw')).toBeInTheDocument();
    expect(screen.getByText('byclaw-dsh')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /openclaw/ }));
    expect(screen.getByText('sandbox.restart.confirm.content:openclaw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sandbox.restart.confirm.ok' }));

    await waitFor(() => {
      expect(mockRestartSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ sandboxType: 'openclaw', sandboxId: 'sandbox-1' })
      );
    });
  });
});
