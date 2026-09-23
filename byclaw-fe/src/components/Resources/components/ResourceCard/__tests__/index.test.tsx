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

jest.mock('@/pages/manager/service/resources', () => ({ publishSkillToEnterprise: jest.fn() }));

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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { publishSkillToEnterprise } from '@/pages/manager/service/resources';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceCard from '..';
import * as globalHook from '@/hooks/useGlobal';

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
  it('replaces processing with success before the row refresh completes', async () => {
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    renderWithQueryClient(
      <ResourceCard
        resource={{ resourceId: 'slow-refresh', resourceBizType: 'SKILL', ownerType: 'personal', canDelete: true }}
        actionConfig={{
          enableResourceLifecycle: true,
          onDeleteData: async (feedback) => {
            feedback.success('Deregistered');
            await refresh;
          },
        }}
      />
    );
    fireEvent.click(screen.getByText('resource.lifecycle.deleteData'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(await screen.findByText('Deregistered')).toBeInTheDocument();
    expect(screen.queryByText('common.processing')).not.toBeInTheDocument();
    finishRefresh();
    await waitFor(() => expect(screen.getByText('Deregistered')).toBeInTheDocument());
  });

  it.each(['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'MCP', 'TOOLKIT', 'AGENT'])(
    'hides authorization for off-shelf %s and restores permitted actions after publishing',
    (resourceBizType) => {
      const client = new QueryClient();
      const onAuth = jest.fn();
      const card = (resourceStatus: string) => (
        <QueryClientProvider client={client}>
          <ResourceCard
            resource={{
              resourceId: 'authorization-state',
              resourceBizType,
              resourceStatus,
              ownerType: 'enterprise',
              canManageAuth: true,
              canUseAuth: true,
              canEdit: true,
            }}
            actionConfig={{ enableResourceLifecycle: true, onAuth }}
          />
        </QueryClientProvider>
      );
      const { rerender } = render(card('3'));
      expect(screen.queryByText('common.manageAuthorization')).toBeNull();
      expect(screen.queryByText('common.useAuthorization')).toBeNull();
      expect(screen.getByText('common.editInfo')).toBeInTheDocument();
      rerender(card('2'));
      fireEvent.click(screen.getByText('common.manageAuthorization'));
      expect(onAuth).toHaveBeenCalledWith('mgrAuth');
      fireEvent.click(screen.getByText('common.useAuthorization'));
      expect(onAuth).toHaveBeenCalledWith('useAuth');
      rerender(card('3'));
      expect(screen.queryByText('common.manageAuthorization')).toBeNull();
      expect(screen.queryByText('common.useAuthorization')).toBeNull();
    }
  );

  it.each([
    { resourceStatus: 3 },
    { metaStatus: '3' },
    { publishStatus: '3' },
    { status: '3' },
    { resourceStatus: 'OFF_SHELF' },
    { resourceStatus: '已下架' },
  ])('hides authorization for legacy off-shelf status: %j', (status) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'legacy-off-shelf',
          resourceBizType: 'DIG_EMPLOYEE',
          canManageAuth: true,
          canUseAuth: true,
          ...status,
        }}
      />
    );
    expect(screen.queryByText('common.manageAuthorization')).toBeNull();
    expect(screen.queryByText('common.useAuthorization')).toBeNull();
  });

  // 员工和资源共用轻量提示；确认后不阻塞其他卡片，失败也须结束提示并允许重试。
  it.each([
    ['DIG_EMPLOYEE', '2', 'resource.unShelfData', 'onUnShelf'],
    ['DIG_EMPLOYEE', '3', 'resource.shelfData', 'onShelf'],
    ['DIG_EMPLOYEE', '3', 'resource.deleteData', 'onDeleteData'],
    ['SKILL', '3', 'resource.lifecycle.shelfData', 'onShelf'],
    ['KG_DOC', '2', 'resource.lifecycle.unShelfData', 'onUnShelf'],
    ['TOOLKIT', '3', 'resource.lifecycle.deleteData', 'onDeleteData'],
  ])('shows processing until %s / %s / %s finishes', async (resourceBizType, resourceStatus, label, callback) => {
    let finish!: () => void;
    const operation = jest.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'processing-resource',
          resourceName: 'Unchanged card',
          resourceBizType,
          resourceStatus,
          ownerType: 'enterprise',
          canOnShelf: true,
          canOffShelf: true,
          canDelete: true,
        }}
        actionConfig={{ enableResourceLifecycle: true, enableDigitalEmployeeDelete: true, [callback]: operation }}
      />
    );
    const title = screen.getByText('Unchanged card');
    fireEvent.click(screen.getByText(label));
    const confirm = await screen.findByRole('button', { name: 'common.confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('common.processing')).toBeInTheDocument();
    expect(screen.getByText('Unchanged card')).toBe(title);
    finish();
    await waitFor(() => expect(screen.queryByText('common.processing')).not.toBeInTheDocument());
  });

  it('clears the processing toast and permits retry after a lifecycle failure', async () => {
    const operation = jest.fn().mockRejectedValueOnce(new Error('Operation failed')).mockResolvedValue(undefined);
    renderWithQueryClient(
      <ResourceCard
        resource={{ resourceId: 'retry', resourceBizType: 'SKILL', ownerType: 'personal', canDelete: true }}
        actionConfig={{ enableResourceLifecycle: true, onDeleteData: operation }}
      />
    );
    fireEvent.click(screen.getByText('resource.lifecycle.deleteData'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(await screen.findByText('Operation failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('common.processing')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('resource.lifecycle.deleteData'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('common.processing')).not.toBeInTheDocument());
  });

  it.each([true, false])('respects hidden deletion for workspace skills: %s', (hidden) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{ resourceId: 'WORKSPACE_SKILL:example', resourceBizType: 'SKILL' }}
        actionConfig={{ canManageWorkspaceSkill: true, hiddenMenuItemKeys: hidden ? ['delete'] : [] }}
      />
    );
    expect(screen.queryByText('resource.deleteSkill') !== null).toBe(!hidden);
    expect(screen.getByText('common.detail')).toBeInTheDocument();
    expect(screen.getByText('common.share')).toBeInTheDocument();
  });

  it.each(
    ['DIG_EMPLOYEE', 'KG_DOC', 'SKILL', 'TOOLKIT'].flatMap((resourceBizType) =>
      ['personal', 'enterprise'].flatMap((ownerType) =>
        ['2', '3'].map((resourceStatus) => ({ resourceBizType, ownerType, resourceStatus }))
      )
    )
  )('hides management actions in browsing cards: %j', (resource) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType={resource.resourceBizType}
        resource={{
          ...resource,
          resourceId: 'browse-resource',
          canOnShelf: true,
          canOffShelf: true,
          canDelete: true,
          canPublishToEnterprise: true,
          canEdit: true,
        }}
        actionConfig={{
          enableResourceLifecycle: true,
          enableDigitalEmployeeLifecycle: false,
          enableDigitalEmployeeDelete: false,
          enablePublishToEnterprise: true,
          hiddenMenuItemKeys: ['shelfData', 'unShelfData', 'deleteData', 'delete', 'publishToEnterprise'],
        }}
      />
    );
    for (const id of [
      'resource.lifecycle.shelfData',
      'resource.lifecycle.unShelfData',
      'resource.lifecycle.deleteData',
      'resource.shelfData',
      'resource.unShelfData',
      'resource.deleteData',
      'resource.publishToEnterprise',
    ]) {
      expect(screen.queryByText(id)).not.toBeInTheDocument();
    }
    expect(screen.getByText('common.editInfo')).toBeInTheDocument();
  });

  it.each([
    ['KG_DOC', 'KG_DOC', 'personal', 'personalKnowledge'],
    ['KG_DOC', 'KG_QA', 'enterprise', 'enterpriseKnowledge'],
    ['KG_DOC', 'KG_TERM', 'personal_default', 'personalKnowledge'],
    ['SKILL', 'SKILL', 'personal', 'personalSkill'],
    ['SKILL', 'SKILL', 'enterprise', 'enterpriseSkill'],
    ['TOOL', 'MCP', 'personal', 'personalTool'],
    ['TOOL', 'TOOLKIT', 'enterprise', 'enterpriseTool'],
    ['TOOL', 'AGENT', 'enterprise', 'enterpriseTool'],
  ])('switches %s / %s from ownership to status in my resources', (resourceType, resourceBizType, ownerType, tag) => {
    const resource = {
      resourceId: 'tag-test',
      resourceName: 'Example',
      resourceBizType,
      ownerType,
      resourceStatus: '2',
    };
    const view = renderWithQueryClient(
      <ResourceCard
        resource={resource}
        resourceType={resourceType}
        actionConfig={{ enableResourceLifecycle: true, showResourceTypeTag: true }}
      />
    );
    expect(screen.getByText(`resource.tag.${tag}`).parentElement).toHaveClass(
      ownerType.startsWith('personal') ? 'digitalEmployeePersonalTag' : 'digitalEmployeeEnterpriseTag'
    );
    expect(screen.queryByText('resourceStatus.published')).not.toBeInTheDocument();
    view.unmount();
    renderWithQueryClient(
      <ResourceCard
        resource={resource}
        resourceType={resourceType}
        actionConfig={{ enableResourceLifecycle: true, showResourceTypeTag: false }}
      />
    );
    expect(screen.getByText('resourceStatus.published')).toBeInTheDocument();
    expect(screen.queryByText(`resource.tag.${tag}`)).not.toBeInTheDocument();
  });

  it('shows ownership on official skill posters', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        resource={{ resourceId: 'poster', resourceBizType: 'SKILL', ownerType: 'enterprise', resourceStatus: '2' }}
        actionConfig={{ enableResourceLifecycle: true, showResourceTypeTag: true }}
      />
    );
    expect(screen.getByText('resource.tag.enterpriseSkill').parentElement).toHaveClass('digitalEmployeeEnterpriseTag');
    expect(screen.queryByText('resourceStatus.published')).not.toBeInTheDocument();
  });

  // 状态、权限和回调一并验证，不能只替换菜单文字却继续调用删除接口。
  it.each([
    ['TOOL', 'TOOLKIT', '2', 'unShelfData', 'onUnShelf'],
    ['TOOL', 'MCP', '3', 'shelfData', 'onShelf'],
    ['KG_DOC', 'KG_DOC', '3', 'deleteData', 'onDeleteData'],
    ['SKILL', 'SKILL', '0', 'shelfData', 'onShelf'],
  ])(
    'confirms lifecycle action for %s / %s in state %s',
    async (resourceType, resourceBizType, status, action, callback) => {
      const onAction = jest.fn();
      const onDelete = jest.fn();
      renderWithQueryClient(
        <ResourceCard
          resourceType={resourceType}
          resource={{
            resourceId: 'lifecycle-resource',
            resourceBizType,
            ownerType: 'enterprise',
            resourceStatus: status,
            canOnShelf: true,
            canOffShelf: true,
            canDelete: true,
          }}
          actionConfig={{ enableResourceLifecycle: true, [callback]: onAction, onDelete }}
        />
      );
      fireEvent.click(screen.getByText(`resource.lifecycle.${action}`));
      expect(await screen.findByText(`resource.lifecycle.${action}Confirm`)).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByText('common.restoreResource')).toBeNull();
    }
  );

  it.each(['TOOL', 'KG_DOC', 'SKILL'])(
    'makes deregistered %s records read-only despite stale permissions',
    (resourceType) => {
      const onCardClick = jest.fn();
      renderWithQueryClient(
        <ResourceCard
          resourceType={resourceType}
          resource={{
            resourceId: 'deregistered',
            resourceName: 'Deregistered record',
            resourceStatus: '-1',
            ownerType: 'enterprise',
            canOnShelf: true,
            canOffShelf: true,
            canDelete: true,
            canEdit: true,
            canRestore: true,
            hasUsePermission: true,
          }}
          onCardClick={onCardClick}
          actionConfig={{ enableResourceLifecycle: true }}
        />
      );
      expect(screen.getByText('resource.statusCancelled')).toBeTruthy();
      expect(screen.queryByText('common.editInfo')).toBeNull();
      expect(screen.queryByText('resource.lifecycle.shelfData')).toBeNull();
      expect(screen.queryByText('resource.lifecycle.deleteData')).toBeNull();
      expect(screen.queryByText('common.restoreResource')).toBeNull();
      fireEvent.click(screen.getByText('Deregistered record'));
      expect(onCardClick).not.toHaveBeenCalled();
    }
  );

  it('does not expose lifecycle actions without backend permission', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="TOOL"
        resource={{
          resourceId: 'denied',
          resourceStatus: '3',
          ownerType: 'enterprise',
          canOnShelf: false,
          canDelete: false,
        }}
        actionConfig={{ enableResourceLifecycle: true }}
      />
    );
    expect(screen.queryByText('resource.lifecycle.shelfData')).toBeNull();
    expect(screen.queryByText('resource.lifecycle.deleteData')).toBeNull();
  });

  it('keeps personal data deletion separate from enterprise shelf actions', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{
          resourceId: 'personal',
          resourceStatus: '2',
          ownerType: 'personal',
          canOnShelf: true,
          canOffShelf: true,
          canDelete: true,
        }}
        actionConfig={{ enableResourceLifecycle: true }}
      />
    );
    expect(screen.getByText('resource.lifecycle.deleteData')).toBeTruthy();
    expect(screen.queryByText('resource.lifecycle.shelfData')).toBeNull();
    expect(screen.queryByText('resource.lifecycle.unShelfData')).toBeNull();
  });

  // 子类型沿用模块名称，确认后仍调用原删除回调。
  it.each([
    ['KG_DOC', 'KG_DOC', 'Knowledge'],
    ['KG_DOC', 'KG_QA', 'Knowledge'],
    ['KG_DOC', 'KG_TERM', 'Knowledge'],
    ['SKILL', 'SKILL', 'Skill'],
    ['TOOL', 'TOOLKIT', 'Tool'],
    ['TOOL', 'MCP', 'Tool'],
    ['TOOL', 'AGENT', 'Tool'],
    ['TOOL', undefined, 'Tool'],
  ])('uses module-specific delete wording for %s / %s', async (resourceType, resourceBizType, label) => {
    const onDelete = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resourceType={resourceType}
        resource={{ resourceId: 'resource-delete', resourceBizType, canDelete: true }}
        actionConfig={{ onDelete }}
      />
    );

    expect(screen.queryByText('common.deleteResource')).toBeNull();
    fireEvent.click(screen.getByText(`resource.delete${label}`));
    expect(await screen.findByText(`resource.delete${label}Confirm`)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // 个人页签关闭上下架操作后，编辑和注销员工仍独立遵循各自权限。
  it.each([
    ['2', 'personal', '001'],
    ['3', 'personal', '001'],
    ['2', 'personal', '017'],
    ['2', 'personal_default', '001'],
  ])(
    'hides shelf actions for personal status %s / %s / %s even when permitted',
    (resourceStatus, ownerType, agentType) => {
      renderWithQueryClient(
        <ResourceCard
          resourceType="DIG_EMPLOYEE"
          digitalEmployeeActionMode
          resource={{
            resourceId: 'personal-lifecycle-employee',
            ownerType,
            agentType,
            resourceStatus,
            canOnShelf: true,
            canOffShelf: true,
            canEdit: true,
            canDelete: true,
          }}
          actionConfig={{
            scene: 'personal',
            enableDigitalEmployeeLifecycle: false,
            enableDigitalEmployeeDelete: true,
          }}
        />
      );

      expect(screen.queryByText('resource.shelfData')).toBeNull();
      expect(screen.queryByText('resource.unShelfData')).toBeNull();
      expect(screen.getByText('common.editInfo')).toBeTruthy();
      expect(screen.getByText('resource.deleteData')).toBeTruthy();
    }
  );

  // 可用的企业员工与员工组均保留下架入口，确认后调用专用下架回调。
  it.each(['001', '017'])('allows taking an available enterprise %s off shelf', async (agentType) => {
    const onUnShelf = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'available-enterprise',
          ownerType: 'enterprise',
          agentType,
          resourceStatus: '2',
          canOffShelf: true,
        }}
        actionConfig={{ enableDigitalEmployeeLifecycle: true, onUnShelf }}
      />
    );

    fireEvent.click(screen.getByText('resource.unShelfData'));
    expect(onUnShelf).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(onUnShelf).toHaveBeenCalledTimes(1);
  });

  it('hides off-shelf action for enterprise employees without operation permissions', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'available-enterprise-no-permission',
          ownerType: 'enterprise',
          resourceStatus: '2',
          canOffShelf: false,
          canEdit: false,
        }}
        actionConfig={{ enableDigitalEmployeeLifecycle: true }}
      />
    );

    expect(screen.queryByText('resource.unShelfData')).toBeNull();
  });

  it('hides personal employee use authorization while retaining other permitted actions', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'personal-employee',
          ownerType: 'personal',
          canUseAuth: true,
          canManageAuth: true,
          canEdit: true,
        }}
        actionConfig={{ scene: 'personal', hiddenMenuItemKeys: ['use'] }}
      />
    );

    expect(screen.queryByText('common.useAuthorization')).toBeNull();
    expect(screen.getByText('common.manageAuthorization')).toBeTruthy();
    expect(screen.getByText('common.editInfo')).toBeTruthy();
  });

  // 即使后端返回授权权限，“我可用的”仍按页面配置屏蔽授权，保留编辑操作。
  it.each(['DIG_EMPLOYEE', 'TOOLKIT', 'KG_DOC', 'SKILL'])(
    'hides authorization actions for available %s resources and restores them outside the available tab',
    (resourceType) => {
      const resource = {
        resourceId: 'available-resource',
        resourceName: 'Available Resource',
        resourceBizType: resourceType,
        canUseAuth: true,
        canManageAuth: true,
        canEdit: true,
      };
      const queryClient = new QueryClient();
      const renderCard = (hiddenMenuItemKeys: string[]) => (
        <QueryClientProvider client={queryClient}>
          <ResourceCard resource={resource} resourceType={resourceType} actionConfig={{ hiddenMenuItemKeys }} />
        </QueryClientProvider>
      );
      const { rerender } = render(renderCard(['authorize', 'use']));

      expect(screen.queryByText('common.useAuthorization')).toBeNull();
      expect(screen.queryByText('common.manageAuthorization')).toBeNull();
      expect(screen.getByText('common.editInfo')).toBeTruthy();

      rerender(renderCard([]));

      expect(screen.getByText('common.useAuthorization')).toBeTruthy();
      expect(screen.getByText('common.manageAuthorization')).toBeTruthy();
    }
  );

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
        actionConfig={{ enableSetDefault: true, onApplyUse: jest.fn(), onEdit: jest.fn(), onAuth: jest.fn() }}
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
        actionConfig={{ enableSetDefault: true }}
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
        actionConfig={{ enableSetDefault: true, onApplyUse: jest.fn() }}
      />
    );

    expect(screen.getByText('resource.applyUse')).toBeTruthy();
  });

  it.each([false, undefined])('hides set default outside the available tab: %s', (enableSetDefault) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-other-page',
          resourceBizType: 'DIG_EMPLOYEE',
          hasUsePermission: true,
          canSetDefault: true,
          isDefault: false,
        }}
        actionConfig={{ enableSetDefault }}
      />
    );
    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  // 有使用权限且后端允许设为默认时，继续显示默认入口。
  it('shows set default for a usable non-default digital employee', () => {
    renderWithQueryClient(
      <ResourceCard
        actionConfig={{ enableSetDefault: true }}
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
        actionConfig={{ enableSetDefault: true }}
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
        actionConfig={{ enableSetDefault: true }}
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

  // 员工与员工组按个人/企业共享样式，仍显示各自的类型文案。
  it.each([
    ['personal', '001', 'personalEmployee', 'digitalEmployeePersonalTag'],
    ['personal', '017', 'personalGroup', 'digitalEmployeePersonalTag'],
    ['personal_default', '001', 'personalEmployee', 'digitalEmployeePersonalTag'],
    ['enterprise', '001', 'enterpriseEmployee', 'digitalEmployeeEnterpriseTag'],
    ['enterprise', '017', 'enterpriseGroup', 'digitalEmployeeEnterpriseTag'],
  ])('shows the type tag for %s / %s', (ownerType, agentType, label, style) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        resource={{ resourceId: 'available-employee', ownerType, agentType, resourceStatus: '2' }}
        actionConfig={{ showDigitalEmployeeTypeTag: true }}
      />
    );

    expect(screen.getByText(`digitalEmployees.tag.${label}`).parentElement).toHaveClass(style);
    expect(screen.queryByText('resourceStatus.published')).toBeNull();
  });

  it('retains status tags for official recommendations', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        resource={{ resourceId: 'official-employee', ownerType: 'enterprise', agentType: '017', resourceStatus: '2' }}
        actionConfig={{ showDigitalEmployeeTypeTag: false }}
      />
    );

    expect(screen.getByText('resourceStatus.published').parentElement).toHaveClass('digitalEmployeeStatusTag');
    expect(screen.queryByText('digitalEmployees.tag.enterpriseGroup')).toBeNull();
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

describe('personal skill enterprise publication', () => {
  const emit = jest.fn();
  const personalSkill = {
    resourceId: 'source-skill',
    resourceName: 'Personal skill',
    resourceBizType: 'SKILL',
    ownerType: 'personal',
    resourceStatus: '2',
    canPublishToEnterprise: true,
  };
  const enterpriseSkill = {
    resourceId: 'enterprise-copy',
    resourceName: 'Enterprise skill',
    resourceBizType: 'SKILL',
    ownerType: 'enterprise',
    resourceStatus: 2,
  };

  beforeEach(() => {
    (publishSkillToEnterprise as jest.Mock).mockReset();
    emit.mockReset();
    jest.spyOn(globalHook, 'default').mockReturnValue({ EventEmitter: { emit } } as any);
  });

  afterEach(() => {
    message.destroy();
    jest.restoreAllMocks();
  });

  it.each([false, undefined])('hides publication unless the brand explicitly enables it: %s', (enabled) => {
    renderWithQueryClient(
      <ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: enabled }} />
    );
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
  });

  it.each([
    { canPublishToEnterprise: false, canEdit: true },
    { canPublishToEnterprise: undefined, hasUsePermission: true },
    { ownerType: 'enterprise' },
    { resourceStatus: '-1' },
    { resourceBizType: 'KG_DOC' },
  ])('hides publication for ineligible skills: %j', (overrides) => {
    renderWithQueryClient(
      <ResourceCard resource={{ ...personalSkill, ...overrides }} actionConfig={{ enablePublishToEnterprise: true }} />
    );
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
  });

  it.each([false, true])('confirms publication and opens the returned copy (existing=%s)', async (alreadyExists) => {
    const onEnterpriseSkillDetail = jest.fn();
    (publishSkillToEnterprise as jest.Mock).mockResolvedValue({ resource: enterpriseSkill, alreadyExists });
    renderWithQueryClient(
      <ResourceCard
        resource={personalSkill}
        actionConfig={{ onEnterpriseSkillDetail, enablePublishToEnterprise: true }}
      />
    );
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    expect(await screen.findByText('resource.publishToEnterpriseConfirm')).toBeInTheDocument();
    expect(publishSkillToEnterprise).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(publishSkillToEnterprise).toHaveBeenCalledTimes(1));
    expect(publishSkillToEnterprise).toHaveBeenCalledWith('source-skill');
    expect(
      await screen.findByText(alreadyExists ? 'resource.enterpriseSkillExists' : 'resource.publishToEnterpriseSuccess')
    ).toBeInTheDocument();
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    expect(screen.getByText('Personal skill')).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('resource.viewEnterpriseSkill'));
    expect(onEnterpriseSkillDetail).toHaveBeenCalledWith(enterpriseSkill);
    expect(personalSkill.ownerType).toBe('personal');
  });

  it('restores the entry when refreshed permissions allow publication after copy removal', () => {
    const client = new QueryClient();
    const card = (allowed: boolean) => (
      <QueryClientProvider client={client}>
        <ResourceCard
          resource={{ ...personalSkill, canPublishToEnterprise: allowed }}
          actionConfig={{ enablePublishToEnterprise: true }}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(card(false));
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    rerender(card(true));
    expect(screen.getByText('resource.publishToEnterprise')).toBeInTheDocument();
  });

  it('reports failures without showing a success message', async () => {
    const success = jest.spyOn(message, 'success');
    (publishSkillToEnterprise as jest.Mock).mockRejectedValue('Publication permission revoked');
    renderWithQueryClient(
      <ResourceCard
        resource={personalSkill}
        actionConfig={{ enablePublishToEnterprise: true }}
      />
    );
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(await screen.findByText('Publication permission revoked')).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('common.processing')).not.toBeInTheDocument());
  });

  it('blocks repeated confirmation while publication is pending', async () => {
    let finish!: (value: any) => void;
    (publishSkillToEnterprise as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    renderWithQueryClient(
      <ResourceCard
        resource={personalSkill}
        actionConfig={{ enablePublishToEnterprise: true }}
      />
    );
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    expect(screen.queryByText('common.processing')).not.toBeInTheDocument();
    const confirm = await screen.findByRole('button', { name: 'common.confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(publishSkillToEnterprise).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('common.processing')).toBeInTheDocument();
    const skillTitle = screen.getByText('Personal skill');
    expect(skillTitle).toBeInTheDocument();
    finish({ resource: enterpriseSkill, alreadyExists: false });
    expect(await screen.findByText('resource.publishToEnterpriseSuccess')).toBeInTheDocument();
    expect(screen.getByText('Personal skill')).toBe(skillTitle);
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('common.processing')).not.toBeInTheDocument());
  });
});
