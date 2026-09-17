jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  getLocale: () => 'zh-CN',
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useDispatch: () => jest.fn(),
  useSelector: (selector: any) =>
    selector({
      user: {
        userInfo: {
          defaultDigEmployeeId: 'default-agent-1',
        },
      },
      employees: {
        defaultDigEmployeeId: 'default-agent-1',
      },
    }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const React = jest.requireActual('react');

  return {
    ...actual,
    Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<any> } }) => (
      <div>
        {children}
        <div>
          {menu?.items?.map((item) => (
            <div key={item?.key}>{item?.label}</div>
          ))}
        </div>
      </div>
    ),
  };
});

jest.mock('@/pages/manager/service/resources', () => ({
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  installDigitalEmployeeRelResources: jest.fn(),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type, className }: { type: string; className?: string }) => (
    <span className={className} data-testid={`icon-${type}`} />
  ),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceCard from '..';

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe('ResourceCard', () => {
  // 个人和企业删除入口均尊重后端权限，并在确认后调用专用删除回调。
  it.each(['personal', 'enterprise'])('confirms delete data for an allowed %s employee', async (ownerType) => {
    const onDeleteData = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'employee-delete',
          resourceName: 'Deletable Employee',
          ownerType,
          resourceStatus: '3',
          canDelete: true,
        }}
        actionConfig={{ enableDigitalEmployeeDelete: true, onDeleteData }}
      />
    );
    fireEvent.click(screen.getByText('resource.deleteData'));
    expect(onDeleteData).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(onDeleteData).toHaveBeenCalledTimes(1);
  });

  // 页面开启入口也不能绕过后端 canDelete=false。
  it('hides delete data when the employee has no delete permission', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{ resourceId: 'employee-no-delete', resourceStatus: '3', canDelete: false }}
        actionConfig={{ enableDigitalEmployeeDelete: true, onDeleteData: jest.fn() }}
      />
    );
    expect(screen.queryByText('resource.deleteData')).toBeNull();
  });

  beforeEach(() => {
    class MockIntersectionObserver {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    }

    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(global, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
  });

  it('shows edit action for tool resources when canEdit is true', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="TOOL"
        resource={{
          resourceId: 'tool-1',
          resourceName: 'My Tool',
          resourceDesc: 'tool desc',
          createUserName: 'tester',
          canEdit: true,
        }}
        actionConfig={{
          onEdit: jest.fn(),
        }}
      />
    );

    expect(screen.getByText('common.editInfo')).toBeTruthy();
  });

  it('hides install skill action when skill has no use permission', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{
          resourceId: 'skill-1',
          resourceName: 'Skill',
          resourceBizType: 'SKILL',
          hasUsePermission: false,
        }}
      />
    );

    expect(screen.queryByText('resource.installSkill')).toBeNull();
  });

  it('shows install skill action when skill has use permission', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{
          resourceId: 'skill-1',
          resourceName: 'Skill',
          resourceBizType: 'SKILL',
          hasUsePermission: true,
        }}
      />
    );

    expect(screen.getByText('resource.installSkill')).toBeTruthy();
  });

  it('hides install skill action when current digital employee already installed it', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{
          resourceId: 'skill-1',
          resourceName: 'Skill',
          resourceBizType: 'SKILL',
          hasUsePermission: true,
        }}
        actionConfig={{
          installedResourceIds: new Set(['skill-1']),
        }}
      />
    );

    expect(screen.queryByText('resource.installSkill')).toBeNull();
  });

  it('hides install knowledge action when current digital employee already installed it', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="KG_DOC"
        resource={{
          resourceId: 'knowledge-1',
          resourceName: 'Knowledge',
          resourceBizType: 'KG_DOC',
        }}
        actionConfig={{
          installedResourceIds: new Set(['knowledge-1']),
        }}
      />
    );

    expect(screen.queryByText('resource.installKnowledge')).toBeNull();
  });

  it('hides install action when the fixed digital employee is not manageable', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="KG_DOC"
        resource={{
          resourceId: 'knowledge-1',
          resourceName: 'Knowledge',
          resourceBizType: 'KG_DOC',
        }}
        actionConfig={{ canInstallToTarget: false }}
      />
    );

    expect(screen.queryByText('resource.installKnowledge')).toBeNull();
  });

  it('shows the default digital employee badge when the digital employee is default', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-1',
          resourceName: 'Default Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          isDefault: true,
        }}
      />
    );

    expect(screen.getByText('resource.defaultDigitalEmployee')).toHaveClass('defaultDigitalEmployeeBadge');
  });

  // 员工卡片保留独立申请按钮和管理操作，不重复展示申请菜单或无使用权限的设为默认。
  it('keeps the apply button and management actions without apply or default menu entries', () => {
    renderWithQueryClient(
      <ResourceCard
        digitalEmployeeActionMode
        resource={{
          resourceId: 'employee-apply',
          resourceName: 'Apply Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          canApplyUse: true,
          resourceStatus: '2',
          hasUsePermission: false,
          canSetDefault: true,
          canEdit: true,
          canManageAuth: true,
        }}
        actionConfig={{ onApplyUse: jest.fn(), onEdit: jest.fn(), onAuth: jest.fn() }}
      />
    );

    expect(screen.getByRole('img', { name: 'plus' }).closest('button')).toBeTruthy();
    expect(screen.queryByText('resource.applyUse')).toBeNull();
    expect(screen.getByText('common.editInfo')).toBeTruthy();
    expect(screen.getByText('common.manageAuthorization')).toBeTruthy();
    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  // 申请中、不可申请及权限缺失时，也不能仅凭 canSetDefault 展示默认入口。
  it.each([
    { hasUsePermission: false, canApplyUse: true, useApplyPending: true },
    { hasUsePermission: false, canApplyUse: false },
    { hasUsePermission: undefined, canApplyUse: false },
  ])('hides set default without use permission: %j', (permissions) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'employee-unavailable',
          resourceName: 'Unavailable Employee Group',
          resourceStatus: '2',
          canSetDefault: true,
          ...permissions,
        }}
      />
    );

    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
    expect(screen.queryByText('resource.applyUse')).toBeNull();
  });

  // 共用卡片组件的其他资源仍通过菜单申请使用权限。
  it('keeps the apply use menu for non-employee resources', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="TOOL"
        resource={{
          resourceId: 'tool-apply',
          resourceName: 'Tool',
          canApplyUse: true,
          hasUsePermission: false,
        }}
        actionConfig={{ onApplyUse: jest.fn() }}
      />
    );

    expect(screen.getByText('resource.applyUse')).toBeTruthy();
  });

  // 有使用权限且后端允许设为默认时，继续显示默认入口。
  it('shows set default for a usable non-default digital employee', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-default',
          resourceName: 'Usable Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          hasUsePermission: true,
          canSetDefault: true,
          isDefault: false,
        }}
      />
    );

    expect(screen.getByText('resource.setDefaultAssistant')).toBeTruthy();
  });

  it('does not show set default for the current default digital employee', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'default-agent-1',
          resourceName: 'Default Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          canSetDefault: false,
          isDefault: true,
        }}
      />
    );

    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  it('does not infer set default from canApplyUse when canSetDefault is false', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-no-default-permission',
          resourceName: 'Unavailable Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          canApplyUse: false,
          canSetDefault: false,
          isDefault: false,
        }}
      />
    );

    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  it('uses personal digital employee tag style for personal digital employees', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-2',
          resourceName: 'Personal Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
        }}
      />
    );

    expect(screen.getByText('digitalEmployees.tag.personalEmployee').parentElement).toHaveClass(
      'digitalEmployeePersonalTag'
    );
  });

  it('keeps non digital employee tags on the base tag style', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'tool-2',
          resourceName: 'Tool',
          resourceBizType: 'TOOLKIT',
          tagName: 'Tool Tag',
        }}
      />
    );

    expect(screen.getByText('Tool Tag').parentElement).not.toHaveClass('digitalEmployeeTag');
    expect(screen.getByText('Tool Tag').parentElement).not.toHaveClass('digitalEmployeePersonalTag');
    expect(screen.getByText('Tool Tag').parentElement).not.toHaveClass('digitalEmployeeDefaultTag');
  });
});
