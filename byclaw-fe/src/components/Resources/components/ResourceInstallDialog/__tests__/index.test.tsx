import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@umijs/max', () => {
  const intl = {
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      values?.names ? `${id}:${values.names}` : id,
  };
  return { useIntl: () => intl };
});

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
  const List = (({ dataSource = [], renderItem }: any) => (
    <div>
      {dataSource.map((item: any) => (
        <div key={item.resourceId}>{renderItem(item)}</div>
      ))}
    </div>
  )) as any;
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

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: any) => <span data-testid="employee-avatar-icon">{type}</span>,
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  batchInstallDigitalEmployeeRelResources: jest.fn(),
  installDigitalEmployeeRelResources: jest.fn(),
  queryInstallTargetEmployees: jest.fn(),
  queryInstalledResourceIds: jest.fn(),
}));

jest.mock('@/utils', () => ({ getPublicPath: () => '/app/' }));
jest.mock('@/utils/file', () => ({ isBase64: () => false }));
jest.mock('@/utils/auth', () => ({}));

import { message } from 'antd';
import {
  installDigitalEmployeeRelResources,
  queryInstallTargetEmployees,
  queryInstalledResourceIds,
} from '@/pages/manager/service/DigitalEmployeeMgr';
import ResourceInstallDialog from '..';

const mockQueryInstalledResourceIds = queryInstalledResourceIds as jest.Mock;
const mockQueryInstallTargetEmployees = queryInstallTargetEmployees as jest.Mock;
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
    mockQueryInstalledResourceIds.mockResolvedValue({ code: 0, data: [] });
    renderFixedTargetDialog();

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => {
      expect(mockQueryInstalledResourceIds).toHaveBeenCalledWith({ resourceId: 'employee-resource-2' });
      expect(mockInstallDigitalEmployeeRelResources).toHaveBeenCalledWith({
        digitalEmployeeId: 'employee-resource-2',
        relIds: ['resource-1'],
      });
    });
  });

  it('does not call the install endpoint when the current employee cannot be validated', async () => {
    mockQueryInstalledResourceIds.mockRejectedValue(new Error('resource not found'));
    renderFixedTargetDialog();

    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('resource.currentEmployeeUnavailable');
    });
    expect(mockInstallDigitalEmployeeRelResources).not.toHaveBeenCalled();
  });
});

describe('ResourceInstallDialog employee avatars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderEmployee = (avatar?: string) => {
    mockQueryInstallTargetEmployees.mockResolvedValue({
      code: 0,
      data: {
        list: [{ resourceId: 'employee-1', resourceName: '员工头像测试', avatar }],
        total: 1,
      },
    });
    return render(
      <ResourceInstallDialog
        open
        resourceId="skill-1"
        resourceType="SKILL"
        targetContext={{ mode: 'select' }}
        onClose={jest.fn()}
      />
    );
  };

  it.each([
    ['beyond/employee.png', '/app/beyond/employee.png'],
    ['https://cdn.example.com/employee.png', 'https://cdn.example.com/employee.png'],
    ['commonFile/preview?filePath=employee.png', '/byaiService/commonFile/preview?filePath=employee.png'],
    ['/byaiService/commonFile/preview?filePath=employee.png', '/byaiService/commonFile/preview?filePath=employee.png'],
    ['default', '/app/beyond/logo256.svg'],
    ['', '/app/beyond/logout.png'],
    [undefined, '/app/beyond/logout.png'],
  ])('renders the employee avatar %s with the shared URL rules', async (avatar, expectedSrc) => {
    renderEmployee(avatar);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toBe(expectedSrc);
    expect(screen.getByText('员工头像测试')).toBeTruthy();
  });

  it('falls back to the default employee avatar when the image cannot load', async () => {
    renderEmployee('https://cdn.example.com/missing.png');

    const image = await screen.findByRole('img');
    fireEvent.error(image);

    expect(image.getAttribute('src')).toBe('/app/beyond/logout.png');
  });

  it('renders an employee icon avatar through the shared renderer', async () => {
    renderEmployee('icon-employee');

    expect((await screen.findByTestId('employee-avatar-icon')).textContent).toBe('icon-employee');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ResourceInstallDialog employee type tags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 技能、知识、工具走同一选择弹窗，默认个人员工同样使用个人标签。
  it.each(['SKILL', 'KG_DOC', 'TOOL'])('uses digital employee module tags when installing %s', async (resourceType) => {
    mockQueryInstallTargetEmployees.mockResolvedValue({
      code: 0,
      data: {
        list: [
          { resourceId: 'personal-1', resourceName: '个人员工', ownerType: 'personal' },
          { resourceId: 'default-1', resourceName: '默认员工', ownerType: 'personal_default' },
          { resourceId: 'enterprise-1', resourceName: '企业员工', ownerType: 'enterprise', installed: true },
        ],
        total: 3,
      },
    });
    render(
      <ResourceInstallDialog
        open
        resourceId="resource-1"
        resourceType={resourceType}
        targetContext={{ mode: 'select' }}
        onClose={jest.fn()}
      />
    );

    const personalTags = await screen.findAllByText('digitalEmployees.tag.personalEmployee');
    expect(personalTags).toHaveLength(2);
    personalTags.forEach((tag) => {
      expect(tag).toHaveClass('tagText');
      expect(tag.parentElement).toHaveClass('tag', 'digitalEmployeePersonalTag');
      expect(tag.parentElement).not.toHaveClass('digitalEmployeeTopRightTag');
    });
    const enterpriseTag = screen.getByText('digitalEmployees.tag.enterpriseEmployee');
    expect(enterpriseTag).toHaveClass('tagText');
    expect(enterpriseTag.parentElement).toHaveClass('tag', 'digitalEmployeeEnterpriseTag');
    expect(enterpriseTag.parentElement).not.toHaveClass('digitalEmployeeTopRightTag');
    expect(screen.getByText('resource.installed')).toBeTruthy();
    expect(screen.queryByText('resource.personalEmployee')).toBeNull();
    expect(screen.queryByText('resource.enterpriseEmployee')).toBeNull();
  });
});
