import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      values?.names ? `${id}:${values.names}` : id,
  }),
}));

jest.mock('antd', () => {
  const Stub = ({ children }: any) => <div>{children}</div>;
  const Modal = ({ children, open, onOk }: any) =>
    open ? (
      <div role="dialog">
        {children}
        <button type="button" onClick={onOk}>
          confirm
        </button>
      </div>
    ) : null;
  Modal.confirm = jest.fn();
  const Input = Stub as any;
  Input.Search = Stub;
  const List = Stub as any;
  List.Item = Stub;

  return {
    Avatar: Stub,
    Checkbox: Stub,
    Empty: Stub,
    Input,
    List,
    Modal,
    Pagination: Stub,
    Tag: Stub,
    message: {
      error: jest.fn(),
      success: jest.fn(),
      warning: jest.fn(),
    },
  };
});

jest.mock('@ant-design/icons', () => ({
  UserOutlined: () => null,
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  batchInstallDigitalEmployeeRelResources: jest.fn(),
  findDetailsById: jest.fn(),
  installDigitalEmployeeRelResources: jest.fn(),
  queryInstallTargetEmployees: jest.fn(),
}));

jest.mock('@/utils/file', () => ({ getFileUrl: (value: string) => value }));

import { message } from 'antd';
import { findDetailsById, installDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import ResourceInstallDialog from '..';

const mockFindDetailsById = findDetailsById as jest.Mock;
const mockInstallDigitalEmployeeRelResources = installDigitalEmployeeRelResources as jest.Mock;
const mockMessageError = message.error as jest.Mock;

const renderFixedTargetDialog = () =>
  render(
    <ResourceInstallDialog
      open
      resourceId="resource-1"
      resourceType="KG_DOC"
      targetContext={{
        mode: 'fixed',
        digitalEmployeeId: 'employee-resource-2',
        digitalEmployeeName: '当前员工',
      }}
      onClose={jest.fn()}
    />
  );

describe('ResourceInstallDialog fixed current employee', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstallDigitalEmployeeRelResources.mockResolvedValue({ code: 0, data: {} });
  });

  it('validates and installs with the resource id shown by the current employee panel', async () => {
    mockFindDetailsById.mockResolvedValue({ code: 0, data: { resourceId: 'employee-resource-2' } });
    renderFixedTargetDialog();

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => {
      expect(mockFindDetailsById).toHaveBeenCalledWith({ resourceId: 'employee-resource-2' });
      expect(mockInstallDigitalEmployeeRelResources).toHaveBeenCalledWith({
        digitalEmployeeId: 'employee-resource-2',
        relIds: ['resource-1'],
      });
    });
  });

  it('does not call the install endpoint when the current employee cannot be validated', async () => {
    mockFindDetailsById.mockRejectedValue(new Error('resource not found'));
    renderFixedTargetDialog();

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('resource.currentEmployeeUnavailable');
    });
    expect(mockInstallDigitalEmployeeRelResources).not.toHaveBeenCalled();
  });
});
