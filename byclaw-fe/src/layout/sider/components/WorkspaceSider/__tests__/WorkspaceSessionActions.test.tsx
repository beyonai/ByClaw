import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
import WorkspaceSessionActions from '../WorkspaceSessionActions';

const mockDispatch = jest.fn();

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const session = {
  sessionId: '2001',
  sessionName: '原会话名称',
};

describe('WorkspaceSessionActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('edits a session through the existing session model action', async () => {
    mockDispatch.mockResolvedValue('2001');
    const onEdited = jest.fn();
    render(<WorkspaceSessionActions session={session} onEdited={onEdited} onDeleted={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));
    fireEvent.click(await screen.findByText('common.edit'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新会话名称' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'session/editSession',
        payload: { sessionId: '2001', sessionName: '新会话名称' },
      });
      expect(onEdited).toHaveBeenCalledWith('新会话名称');
    });
  });

  it('deletes a session after confirmation', async () => {
    mockDispatch.mockResolvedValue('2001');
    const onDeleted = jest.fn();
    jest.spyOn(Modal, 'confirm').mockImplementation((config: any) => {
      void config.onOk();
      return { destroy: jest.fn(), update: jest.fn() } as any;
    });
    render(<WorkspaceSessionActions session={session} onEdited={jest.fn()} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));
    fireEvent.click(await screen.findByText('common.delete'));

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'session/deleteSession',
        payload: { sessionId: '2001' },
      });
      expect(onDeleted).toHaveBeenCalled();
    });
  });
});
