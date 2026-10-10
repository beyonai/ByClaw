jest.mock('@/service/employeePublication', () => ({
  ...jest.requireActual('@/service/employeePublication'),
  openEmployeePublication: jest.fn(),
}));
import { openEmployeePublication } from '@/service/employeePublication';
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
    // 保留真实确认交互，去掉弹层动画准备阶段，避免全量运行时等待过渡。
    Popconfirm: (props: import('antd').PopconfirmProps) => <actual.Popconfirm {...props} transitionName="" />,
    Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<any> } }) => (
      <div>
        {children}
        <div>
          {menu?.items?.map((item) => (
            // 模拟 Menu 的条目点击分发，禁用项不触发业务回调。
            <div
              key={item?.key}
              data-testid={`resource-menu-${item?.key}`}
              onClick={item?.disabled ? undefined : item?.onClick}
            >
              {item?.label}
            </div>
          ))}
        </div>
      </div>
    ),
  };
});

jest.mock('@/pages/manager/service/resources', () => ({
  publishSkillToEnterprise: jest.fn(),
  getSkillPublicationPermissions: jest.fn(),
  checkWorkspaceSkillShareConflicts: jest.fn(),
  resourceizeWorkspaceSkill: jest.fn(),
  queryWorkspaceSkillDetail: jest.fn(),
  queryResourceMembers: jest.fn(),
}));

jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({
  installDigitalEmployeeRelResources: jest.fn(),
}));

// 安装弹窗自身的目标查询和安装流程由其独立用例覆盖，这里验证卡片入口及事件边界。
jest.mock('@/components/Resources/components/ResourceInstallDialog', () => ({
  __esModule: true,
  default: ({ resourceId, targetContext, onClose, onInstallingChange }: any) => (
    <div
      role="dialog"
      aria-label="install-dialog"
      data-resource-id={resourceId}
      data-target-context={JSON.stringify(targetContext)}
    >
      <button type="button" onClick={onClose}>
        close-install
      </button>
      <button type="button" onClick={() => onInstallingChange(true)}>
        start-install
      </button>
    </div>
  ),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type, className }: { type: string; className?: string }) => (
    <span className={className} data-testid={`icon-${type}`} />
  ),
}));

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, message, Modal } from 'antd';
import {
  publishSkillToEnterprise,
  getSkillPublicationPermissions,
  checkWorkspaceSkillShareConflicts,
  resourceizeWorkspaceSkill,
  queryWorkspaceSkillDetail,
} from '@/pages/manager/service/resources';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceCard from '..';
import * as globalHook from '@/hooks/useGlobal';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { DetailPanelContent, useDetailPanelState } from '@/layout/pcLayout/useDetailPanelState';

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </ConfigProvider>
  );
};

// 卡片包含真实确认弹层与全局消息；只增加用例总预算，不延长查找/断言超时。
const lifecycleTestTimeout = 15000;

beforeAll(() => {
  // 静态 message/Modal 使用独立 React 根，需要单独关闭动画，才能沿用容器内的测试配置。
  ConfigProvider.config({
    holderRender: (children) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });
});

afterAll(() => {
  ConfigProvider.config({ holderRender: undefined });
});

afterEach(async () => {
  jest.restoreAllMocks();
  cleanup();
  // 依赖提醒由静态 Modal 创建，不属于 render 容器；失败用例也必须清理，避免确认按钮串用例。
  await act(async () => {
    Modal.destroyAll();
    message.destroy();
  });
  await waitFor(() => {
    expect(document.querySelector('.ant-modal-root')).toBeNull();
    expect(document.querySelector('.ant-message-notice')).toBeNull();
  });
});

describe('ResourceCard', () => {
  it(
    'replaces processing with success before the row refresh completes',
    async () => {
      let finishRefresh!: () => void;
      const refresh = new Promise<void>((resolve) => {
        finishRefresh = resolve;
      });
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
      expect(screen.queryAllByText('common.processing')).toHaveLength(0);
      await act(async () => {
        finishRefresh();
        await refresh;
      });
      expect(screen.getByText('Deregistered')).toBeInTheDocument();
    },
    lifecycleTestTimeout
  );

  // 我的员工按后端权限显示全部管理入口，员工组、下架状态及申请待审核均不能再次屏蔽菜单。
  it.each([
    ['001', '2', true],
    ['017', '2', true],
    ['001', '3', false],
    ['017', '3', false],
  ] as const)(
    'shows permitted available employee actions for %s / %s / pending %s',
    (agentType, resourceStatus, pending) => {
      const onAuth = jest.fn();
      renderWithQueryClient(
        <ResourceCard
          resourceType="DIG_EMPLOYEE"
          digitalEmployeeActionMode
          resource={{
            resourceId: 'available-all-actions',
            ownerType: 'enterprise',
            agentType,
            resourceStatus,
            useApplyPending: pending,
            hasUsePermission: true,
            canSetDefault: true,
            canEdit: true,
            canManageAuth: true,
            canUseAuth: true,
            canDelete: true,
            canOnShelf: true,
            canOffShelf: true,
            canPublishEmployee: true,
            employeePublicationStatus: 'PUBLISHED',
          }}
          actionConfig={{
            enableDigitalEmployeeLifecycle: true,
            enableDigitalEmployeeDelete: true,
            onAuth,
          }}
        />
      );
      [
        'edit',
        'authorize',
        'use',
        'shelfData',
        'unShelfData',
        'deleteData',
        'setDefaultAssistant',
        'publishEmployee',
        'viewEmployeePublication',
      ].forEach((key) => {
        expect(screen.getByTestId(`resource-menu-${key}`)).toBeInTheDocument();
      });
      expect(screen.getByRole('img', { name: 'message' }).closest('button')).toBeInTheDocument();
      fireEvent.click(screen.getByText('common.manageAuthorization'));
      fireEvent.click(screen.getByText('common.useAuthorization'));
      expect(onAuth.mock.calls).toEqual([['mgrAuth'], ['useAuth']]);
    }
  );

  it('does not expose available employee actions without backend permissions', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'available-no-actions',
          ownerType: 'enterprise',
          agentType: '017',
          resourceStatus: '2',
          hasUsePermission: false,
          canSetDefault: false,
          canEdit: false,
          canManageAuth: false,
          canUseAuth: false,
          canDelete: false,
          canOnShelf: false,
          canOffShelf: false,
          canPublishEmployee: false,
          canApplyUse: false,
        }}
        actionConfig={{
          enableDigitalEmployeeLifecycle: true,
          enableDigitalEmployeeDelete: true,
        }}
      />
    );
    expect(screen.queryAllByTestId(/^resource-menu-/)).toHaveLength(0);
    expect(screen.queryByRole('img', { name: 'message' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'plus' })).toBeNull();
  });

  it('preserves permitted employee management actions while a use application is pending', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'other-scene-pending',
          resourceStatus: '2',
          useApplyPending: true,
          canEdit: true,
          canManageAuth: true,
          canUseAuth: true,
        }}
      />
    );
    expect(screen.getByText('common.editInfo')).toBeInTheDocument();
    expect(screen.getByText('common.manageAuthorization')).toBeInTheDocument();
    expect(screen.getByText('common.useAuthorization')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ellipsis' })).toBeInTheDocument();
  });

  it.each(['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'MCP', 'TOOLKIT', 'AGENT'])(
    'uses employee authorization flags and preserves other resource shelf rules: %s',
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
      expect(Boolean(screen.queryByText('common.manageAuthorization'))).toBe(resourceBizType === 'DIG_EMPLOYEE');
      expect(Boolean(screen.queryByText('common.useAuthorization'))).toBe(resourceBizType === 'DIG_EMPLOYEE');
      expect(screen.getByText('common.editInfo')).toBeInTheDocument();
      rerender(card('2'));
      fireEvent.click(screen.getByText('common.manageAuthorization'));
      expect(onAuth).toHaveBeenCalledWith('mgrAuth');
      fireEvent.click(screen.getByText('common.useAuthorization'));
      expect(onAuth).toHaveBeenCalledWith('useAuth');
      rerender(card('3'));
      expect(Boolean(screen.queryByText('common.manageAuthorization'))).toBe(resourceBizType === 'DIG_EMPLOYEE');
      expect(Boolean(screen.queryByText('common.useAuthorization'))).toBe(resourceBizType === 'DIG_EMPLOYEE');
    }
  );

  it.each([
    { resourceStatus: 3 },
    { metaStatus: '3' },
    { publishStatus: '3' },
    { status: '3' },
    { resourceStatus: 'OFF_SHELF' },
    { resourceStatus: '已下架' },
  ])('uses backend employee authorization flags regardless of legacy shelf status: %j', (status) => {
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
    expect(screen.getByText('common.manageAuthorization')).toBeInTheDocument();
    expect(screen.getByText('common.useAuthorization')).toBeInTheDocument();
  });

  it.each([true, false])(
    'uses normal edit and management authorization permissions for adminvip-created employees: %s',
    (allowed) => {
      const onAuth = jest.fn();
      renderWithQueryClient(
        <ResourceCard
          resourceType="DIG_EMPLOYEE"
          resource={{
            resourceId: 'adminvip-employee',
            resourceBizType: 'DIG_EMPLOYEE',
            ownerType: 'enterprise',
            resourceStatus: '2',
            canEdit: allowed,
            hasManagePermission: allowed,
            canManageAuth: allowed,
            canUseAuth: true,
          }}
          actionConfig={{ onAuth }}
        />
      );
      if (allowed) {
        expect(screen.getByText('common.editInfo')).toBeInTheDocument();
        fireEvent.click(screen.getByText('common.manageAuthorization'));
        expect(onAuth).toHaveBeenCalledWith('mgrAuth');
      } else {
        expect(screen.queryByText('common.editInfo')).toBeNull();
        expect(screen.queryByTestId('resource-menu-authorize')).toBeNull();
      }
      fireEvent.click(screen.getByText('common.useAuthorization'));
      expect(onAuth).toHaveBeenCalledWith('useAuth');
    }
  );

  // 员工和资源共用轻量提示；确认后不阻塞其他卡片，失败也须结束提示并允许重试。
  it.each([
    ['DIG_EMPLOYEE', '2', 'resource.unShelfData', 'onUnShelf'],
    ['DIG_EMPLOYEE', '3', 'resource.shelfData', 'onShelf'],
    ['DIG_EMPLOYEE', '3', 'resource.deleteData', 'onDeleteData'],
    ['SKILL', '3', 'resource.lifecycle.shelfData', 'onShelf'],
    ['KG_DOC', '2', 'resource.lifecycle.unShelfData', 'onUnShelf'],
    ['TOOLKIT', '3', 'resource.lifecycle.deleteData', 'onDeleteData'],
  ])(
    'shows processing until %s / %s / %s finishes',
    async (resourceBizType, resourceStatus, label, callback) => {
      let finish!: () => void;
      const operation = jest.fn(
        () =>
          new Promise<void>((resolve) => {
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
      await act(async () => {
        finish();
        await operation.mock.results[0].value;
      });
      await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
    },
    lifecycleTestTimeout
  );

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
    await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
    fireEvent.click(screen.getByText('resource.lifecycle.deleteData'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
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
    ['TOOL', 'MCP_TOOL', 'personal_default', 'personalTool'],
    ['TOOL', 'TOOL', 'personal', 'personalTool'],
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
    // 知识和工具使用各自的角标布局，保留其他资源的布局边界。
    const badge = screen.getByText(`resource.tag.${tag}`).parentElement!;
    if (resourceType === 'KG_DOC') {
      expect(badge).toHaveClass('knowledgeTopRightTag');
      expect(badge.parentElement).toHaveClass('knowledgeHeaderWithTag');
    } else {
      expect(badge).not.toHaveClass('knowledgeTopRightTag');
      expect(badge.parentElement).not.toHaveClass('knowledgeHeaderWithTag');
    }
    if (resourceType === 'TOOL') {
      expect(badge).toHaveClass('toolTopRightTag');
      expect(badge.parentElement).toHaveClass('toolHeaderWithTag');
      expect(badge).toHaveAttribute('title', `resource.tag.${tag}`);
    } else {
      expect(badge).not.toHaveClass('toolTopRightTag');
      expect(badge.parentElement).not.toHaveClass('toolHeaderWithTag');
    }
    if (resourceType === 'SKILL') {
      expect(badge).toHaveClass('skillTopRightTag');
      expect(badge.parentElement).toHaveClass('skillHeaderWithTag');
      expect(badge).toHaveAttribute('title', `resource.tag.${tag}`);
    } else {
      expect(badge).not.toHaveClass('skillTopRightTag');
      expect(badge.parentElement).not.toHaveClass('skillHeaderWithTag');
    }
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
    if (resourceType === 'KG_DOC') {
      expect(screen.getByText('resourceStatus.published').parentElement).toHaveClass('knowledgeTopRightTag');
    }
    if (resourceType === 'TOOL') {
      expect(screen.getByText('resourceStatus.published').parentElement).toHaveClass('toolTopRightTag');
    }
    if (resourceType === 'SKILL') {
      expect(screen.getByText('resourceStatus.published').parentElement).toHaveClass('skillTopRightTag');
    }
  });

  it.each(['SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'TOOL', 'TOOLKIT', 'MCP', 'MCP_TOOL', 'AGENT'])(
    'positions a %s tag without action space and preserves the card click',
    (resourceBizType) => {
      const isKnowledge = resourceBizType.startsWith('KG_');
      const prefix = resourceBizType === 'SKILL' ? 'skill' : isKnowledge ? 'knowledge' : 'tool';
      const tagClass = `${prefix}TopRightTag`;
      const headerClass = `${prefix}HeaderWithTag`;
      const installLabel = `resource.install${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
      const onCardClick = jest.fn();
      const resource = {
        resourceId: 'resource-corner',
        resourceName: 'A long resource name that must not overlap the corner tag',
        resourceBizType,
        tagName: 'Corner tag',
        hasUsePermission: true,
      };
      // 使用权限同时允许安装；显式关闭目标安装才能构造“无操作区”的布局场景。
      renderWithQueryClient(
        <ResourceCard resource={resource} onCardClick={onCardClick} actionConfig={{ canInstallToTarget: false }} />
      );
      const badge = screen.getByText('Corner tag').parentElement!;
      const title = screen.getByText(resource.resourceName);
      expect(badge).toHaveClass(tagClass);
      expect(badge).toHaveAttribute('title', 'Corner tag');
      expect(title.parentElement).toHaveClass(headerClass);
      expect(title.closest('.resourceInfo')).not.toHaveClass('resourceInfoWithActions');
      expect(screen.queryByRole('button', { name: installLabel })).not.toBeInTheDocument();
      fireEvent.click(badge);
      expect(onCardClick).toHaveBeenCalledWith(resource);
    }
  );

  it.each([
    { resourceBizType: 'KG_DOC', hasUsePermission: false },
    { resourceBizType: 'KG_QA', hasUsePermission: false },
    { resourceBizType: 'KG_TERM', hasUsePermission: false },
    { resourceBizType: 'KG_DOC', hasUsePermission: undefined },
    { resourceType: 'KG_DOC', hasUsePermission: false },
    { resourceBizType: 'KG_DOC', hasUsePermission: false, hasManagePermission: true, canViewDetail: true },
    { resourceBizType: 'KG_DOC', hasUsePermission: false, useApplyPending: true },
  ])('blocks knowledge detail without use permission: %j', ({ resourceType, ...permissions }) => {
    const onCardClick = jest.fn();
    const onCardClickDisabled = jest.fn();
    const resource = {
      resourceId: 'unusable-knowledge',
      resourceName: 'Restricted knowledge',
      resourceDesc: 'Restricted content',
      tagName: 'Knowledge tag',
      ...permissions,
    };
    renderWithQueryClient(
      <ResourceCard
        resource={resource}
        resourceType={resourceType}
        onCardClick={onCardClick}
        onCardClickDisabled={onCardClickDisabled}
      />
    );
    const title = screen.getByText(resource.resourceName);
    // 鼠标经过正文和卡片留白均显示禁用；不能用 pointer-events 阻断申请按钮。
    expect(title.closest('.resourceCard')).toHaveClass('disabledClickCard');
    expect(title.closest('.resourceCard')).not.toHaveClass('pointer');
    expect(title.closest('.renderContent')).toHaveClass('disabledClickContent');
    expect(title.closest('.renderContent')).not.toHaveClass('pointer');
    fireEvent.click(title);
    fireEvent.click(screen.getByText(resource.resourceDesc));
    fireEvent.click(screen.getByText(resource.tagName));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardClickDisabled).toHaveBeenCalledTimes(3);
    expect(onCardClickDisabled).toHaveBeenCalledWith(resource);
  });

  it('updates knowledge detail access and cursor when use permission changes', () => {
    const client = new QueryClient();
    const onCardClick = jest.fn();
    const card = (hasUsePermission: boolean) => (
      <QueryClientProvider client={client}>
        <ResourceCard
          resource={{
            resourceId: 'knowledge-permission',
            resourceName: 'Knowledge access',
            resourceBizType: 'KG_DOC',
            hasUsePermission,
          }}
          onCardClick={onCardClick}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(card(false));
    fireEvent.click(screen.getByText('Knowledge access'));
    expect(onCardClick).not.toHaveBeenCalled();
    rerender(card(true));
    const title = screen.getByText('Knowledge access');
    expect(title.closest('.resourceCard')).toHaveClass('pointer');
    expect(title.closest('.renderContent')).toHaveClass('pointer');
    expect(title.closest('.resourceCard')).not.toHaveClass('disabledClickCard');
    expect(title.closest('.renderContent')).not.toHaveClass('disabledClickContent');
    fireEvent.click(title);
    expect(onCardClick).toHaveBeenCalledTimes(1);
    rerender(card(false));
    expect(title.closest('.resourceCard')).toHaveClass('disabledClickCard');
    fireEvent.click(title);
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it.each([true, () => true])('preserves explicit card click restrictions for usable knowledge: %s', (disabled) => {
    const onCardClick = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'disabled-knowledge',
          resourceName: 'Disabled knowledge',
          resourceBizType: 'KG_DOC',
          hasUsePermission: true,
        }}
        cardClickDisabled={disabled}
        onCardClick={onCardClick}
      />
    );
    const title = screen.getByText('Disabled knowledge');
    expect(title.closest('.resourceCard')).toHaveClass('disabledClickCard');
    expect(title.closest('.renderContent')).toHaveClass('disabledClickContent');
    fireEvent.click(title);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it.each(['SKILL', 'MCP', 'DIG_EMPLOYEE'])('preserves %s detail access without knowledge restrictions', (type) => {
    const onCardClick = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resource={{ resourceId: 'other-resource', resourceName: 'Other resource', resourceBizType: type }}
        onCardClick={onCardClick}
      />
    );
    const title = screen.getByText('Other resource');
    expect(title.closest('.resourceCard')).not.toHaveClass('disabledClickCard');
    fireEvent.click(title);
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['4', 'resourceStatus.reviewing'],
    ['5', 'resourceStatus.notPassed'],
  ])('shows the review state %s in my enterprise skills', (status, label) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        resource={{
          resourceId: 'review-skill',
          resourceBizType: 'SKILL',
          ownerType: 'enterprise',
          resourceStatus: status,
        }}
        actionConfig={{ enableResourceLifecycle: true, showResourceTypeTag: false }}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('resourceStatus.published')).not.toBeInTheDocument();
  });

  it.each([
    ['personal', 'personalSkill', 'digitalEmployeePersonalTag'],
    ['enterprise', 'enterpriseSkill', 'digitalEmployeeEnterpriseTag'],
  ])('places the %s skill ownership tag in the card corner outside the title row', (ownerType, tag, tagClass) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        resource={{
          resourceId: 'poster',
          resourceName: 'A long skill name that should retain its title space',
          resourceBizType: 'SKILL',
          ownerType,
          resourceStatus: '2',
        }}
        actionConfig={{ enableResourceLifecycle: true, showResourceTypeTag: true }}
      />
    );
    const badge = screen.getByText(`resource.tag.${tag}`).parentElement!;
    const title = screen.getByText('A long skill name that should retain its title space');
    expect(badge).toHaveClass('skillPosterTag', tagClass);
    expect(badge).toHaveAttribute('title', `resource.tag.${tag}`);
    expect(badge.parentElement).toHaveClass('skillPosterContent');
    expect(title.parentElement).toHaveClass('skillPosterHeaderWithTag');
    expect(title.parentElement).not.toContainElement(badge);
    expect(screen.queryByText('resourceStatus.published')).not.toBeInTheDocument();
  });

  describe('skill poster title space', () => {
    const originalResizeObserver = Object.getOwnPropertyDescriptor(global, 'ResizeObserver');
    let tagWidth: number;
    let notifyTagResize: () => void;
    let disconnect: jest.Mock;
    let observe: jest.Mock;

    const skillCard = (showActions = false, variant: 'default' | 'skillPoster' = 'skillPoster') => (
      <ResourceCard
        resourceType="SKILL"
        variant={variant}
        resource={{
          resourceId: 'poster-width',
          resourceName: 'content-image-enrichment-with-a-long-name',
          resourceBizType: 'SKILL',
          ownerType: 'enterprise',
          resourceStatus: '2',
          hasUsePermission: true,
          operationPermissionsLoaded: true,
        }}
        actionConfig={{
          enableResourceLifecycle: true,
          showResourceTypeTag: true,
          canInstallToTarget: showActions,
        }}
      />
    );

    beforeEach(() => {
      tagWidth = 56;
      // JSDOM 不计算布局，用标签边界模拟真实中文/长译文宽度，其他节点保留默认边界。
      const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const rect = getBoundingClientRect.call(this);
        return this.classList.contains('skillPosterTag') ? { ...rect, width: tagWidth } : rect;
      });
      observe = jest.fn();
      disconnect = jest.fn();
      Object.defineProperty(global, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: jest.fn((callback: ResizeObserverCallback) => {
          const observer = { observe, disconnect, unobserve: jest.fn() };
          notifyTagResize = () => callback([], observer as unknown as ResizeObserver);
          return observer;
        }),
      });
    });

    afterEach(() => {
      if (originalResizeObserver) {
        Object.defineProperty(global, 'ResizeObserver', originalResizeObserver);
      } else {
        Reflect.deleteProperty(global, 'ResizeObserver');
      }
    });

    it.each([false, true])('measures the actual tag width with actions: %s', (showActions) => {
      renderWithQueryClient(skillCard(showActions));
      const title = screen.getByText('content-image-enrichment-with-a-long-name');
      const badge = screen.getByText('resource.tag.enterpriseSkill').parentElement!;
      expect(title.parentElement!.style.getPropertyValue('--skill-poster-tag-width')).toBe('56px');
      expect(title.closest('.skillPosterBody')!.classList.contains('resourceInfoWithActions')).toBe(showActions);
      expect(observe).toHaveBeenCalledWith(badge);
      expect(title.parentElement).not.toContainElement(badge);
    });

    it('updates the title space after tag resizing and ignores temporarily hidden tags', () => {
      const { unmount } = renderWithQueryClient(skillCard());
      const header = screen.getByText('content-image-enrichment-with-a-long-name').parentElement!;
      tagWidth = 88;
      act(() => notifyTagResize());
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('88px');
      tagWidth = 0;
      act(() => notifyTagResize());
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('88px');
      tagWidth = 56;
      act(() => notifyTagResize());
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('56px');
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('remeasures on window resize when ResizeObserver is unavailable and cleans up the listener', () => {
      Object.defineProperty(global, 'ResizeObserver', { value: undefined });
      const removeEventListener = jest.spyOn(window, 'removeEventListener');
      const { unmount } = renderWithQueryClient(skillCard());
      const header = screen.getByText('content-image-enrichment-with-a-long-name').parentElement!;
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('56px');
      tagWidth = 88;
      fireEvent(window, new Event('resize'));
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('88px');
      unmount();
      expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('preserves the default skill card layout without measuring its tag', () => {
      renderWithQueryClient(skillCard(false, 'default'));
      const header = screen.getByText('content-image-enrichment-with-a-long-name').parentElement!;
      expect(header.style.getPropertyValue('--skill-poster-tag-width')).toBe('');
      expect(observe).not.toHaveBeenCalled();
    });
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

  // 复用方显式关闭生命周期时，编辑和注销仍独立遵循各自权限。
  it.each([
    ['2', 'personal', '001'],
    ['3', 'personal', '001'],
    ['2', 'personal', '017'],
    ['2', 'personal_default', '001'],
  ])('supports an explicit lifecycle opt-out for status %s / %s / %s', (resourceStatus, ownerType, agentType) => {
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
  });

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

  it.each([false, undefined])('does not infer shelf actions from edit permission: %s', (permission) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'available-enterprise-no-permission',
          ownerType: 'enterprise',
          resourceStatus: '2',
          canOffShelf: permission,
          canOnShelf: permission,
          canEdit: true,
        }}
        actionConfig={{ enableDigitalEmployeeLifecycle: true }}
      />
    );

    expect(screen.queryByText('resource.unShelfData')).toBeNull();
    expect(screen.queryByText('resource.shelfData')).toBeNull();
  });

  it.each([false, undefined, true])('uses backend use permission for employee conversation entry: %s', (permission) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="DIG_EMPLOYEE"
        digitalEmployeeActionMode
        resource={{
          resourceId: 'employee-chat-permission',
          resourceStatus: '2',
          hasUsePermission: permission,
          canApplyUse: false,
          canEdit: true,
        }}
      />
    );
    expect(Boolean(screen.queryByRole('img', { name: 'message' }))).toBe(permission === true);
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

  it.each(['default', 'skillPoster'] as const)('hides the %s skill install icon without use permission', (variant) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant={variant}
        resource={{
          resourceId: 'skill-1',
          resourceName: 'Skill',
          resourceBizType: 'SKILL',
          hasUsePermission: false,
          canApplyUse: true,
          resourceStatus: '2',
        }}
        actionConfig={{ enableResourceLifecycle: true }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.installSkill' })).toBeNull();
    expect(screen.getByRole('button', { name: 'resource.applyUse' })).toBeInTheDocument();
    expect(screen.queryByTestId('resource-menu-applyUse')).toBeNull();
  });

  it.each([
    ['SKILL', 'default'],
    ['SKILL', 'skillPoster'],
    ['KG_DOC', 'default'],
    ['TOOL', 'default'],
  ] as const)('confirms use applications from the %s %s card icon', async (resourceType, variant) => {
    const onApplyUse = jest.fn();
    const onCardClick = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resourceType={resourceType}
        variant={variant}
        onCardClick={onCardClick}
        resource={{
          resourceId: 'resource-apply',
          resourceBizType: resourceType,
          resourceStatus: '2',
          canApplyUse: true,
          hasUsePermission: false,
          canEdit: true,
        }}
        actionConfig={{ enableResourceLifecycle: true, onApplyUse }}
      />
    );

    const applyButton = screen.getByRole('button', { name: 'resource.applyUse' });
    expect(applyButton).toHaveClass('ant-btn-circle', 'cardPrimaryActionBtn');
    if (resourceType === 'KG_DOC') {
      expect(applyButton.parentElement).toHaveClass('digitalEmployeeActions', 'knowledgeActions');
      expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
      expect(screen.queryByTestId('resource-menu-install')).toBeNull();
    }
    expect(screen.queryByTestId('resource-menu-applyUse')).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.installSkill' })).toBeNull();
    expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
    fireEvent.click(applyButton);
    expect(onApplyUse).not.toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(onApplyUse).toHaveBeenCalledTimes(1));
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('does not submit a use application when confirmation is cancelled', async () => {
    const onApplyUse = jest.fn();
    const onCardClick = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        onCardClick={onCardClick}
        resource={{
          resourceId: 'skill-apply',
          resourceStatus: '2',
          canApplyUse: true,
          hasUsePermission: false,
        }}
        actionConfig={{ enableResourceLifecycle: true, onApplyUse }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'resource.applyUse' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));
    expect(onApplyUse).not.toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it.each([
    ['SKILL', 'SKILL', 'default'],
    ['SKILL', 'SKILL', 'skillPoster'],
    ['KG_DOC', 'KG_DOC', 'default'],
    ['KG_DOC', 'KG_QA', 'default'],
    ['KG_DOC', 'KG_TERM', 'default'],
    ['KG_DOC', 'KG_DB', 'default'],
    ['TOOL', 'TOOL', 'default'],
    ['TOOL', 'TOOLKIT', 'default'],
    ['TOOL', 'MCP', 'default'],
    ['TOOL', 'MCP_TOOL', 'default'],
    ['TOOL', 'AGENT', 'default'],
  ] as const)(
    'shares one primary action alignment across %s / %s / %s states and menu visibility',
    (resourceType, resourceBizType, variant) => {
      // 切换申请、待审核、安装及菜单权限，三个模块共用纵向操作区及固定正文留白。
      const client = new QueryClient();
      const renderCard = (state: 'apply' | 'pending' | 'install', showMenu: boolean) => (
        <QueryClientProvider client={client}>
          <ResourceCard
            resourceType={resourceType}
            variant={variant}
            resource={{
              resourceId: 'aligned-resource',
              resourceName: 'Aligned resource',
              resourceBizType,
              resourceStatus: '2',
              hasUsePermission: state === 'install',
              canApplyUse: state === 'apply',
              useApplyPending: state === 'pending',
              canEdit: showMenu,
            }}
            actionConfig={{ enableResourceLifecycle: true }}
          />
        </QueryClientProvider>
      );
      const { rerender } = render(renderCard('apply', true));
      const states = ['apply', 'pending', 'install'] as const;
      const actions = screen.getByRole('button', { name: 'resource.applyUse' }).parentElement!;

      for (const state of states) {
        for (const showMenu of [true, false]) {
          rerender(renderCard(state, showMenu));
          const label =
            state === 'apply'
              ? 'resource.applyUse'
              : state === 'pending'
              ? 'resource.pendingAuthorization'
              : resourceType === 'SKILL'
              ? 'resource.installSkill'
              : resourceType === 'TOOL'
              ? 'resource.installTool'
              : 'resource.installKnowledge';
          const button = screen.getByRole('button', { name: label });
          expect(button.closest('.resourceCardActions')).toBe(actions);
          expect(actions).toHaveClass('resourceCardActions');
          expect(actions.firstElementChild).toContainElement(button);
          expect(within(actions).getAllByRole('button')).toHaveLength(showMenu ? 2 : 1);
          const title = screen.getByText('Aligned resource');
          const content = title.closest(variant === 'skillPoster' ? '.skillPosterBody' : '.resourceInfo');
          expect(content).toHaveClass('resourceInfoWithActions');
          expect(content).not.toHaveClass('resourceInfoWithMoreActions');
        }
      }
    }
  );

  it.each([
    ['SKILL', 'default'],
    ['SKILL', 'skillPoster'],
    ['KG_DOC', 'default'],
    ['TOOL', 'default'],
    ['DIG_EMPLOYEE', 'default'],
  ] as const)(
    'shows pending status only when hovering the disabled icon for %s %s cards',
    async (resourceType, variant) => {
      // JSDOM 不计算尺寸；提供图标与弹层的边界，让真实 Tooltip 完成定位和显示。
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 32,
        bottom: 32,
        width: 32,
        height: 32,
        toJSON: () => ({}),
      });
      renderWithQueryClient(
        <ResourceCard
          resourceType={resourceType}
          variant={variant}
          digitalEmployeeActionMode={resourceType === 'DIG_EMPLOYEE'}
          resource={{
            resourceId: 'resource-pending',
            resourceBizType: resourceType,
            agentType: resourceType === 'DIG_EMPLOYEE' ? '017' : undefined,
            resourceStatus: '2',
            hasUsePermission: false,
            canApplyUse: true,
            useApplyPending: true,
            canEdit: true,
          }}
          actionConfig={{ enableResourceLifecycle: true }}
        />
      );

      const pendingButton = screen.getByRole('button', { name: 'resource.pendingAuthorization' });
      expect(pendingButton).toBeDisabled();
      if (resourceType === 'DIG_EMPLOYEE') {
        expect(pendingButton.closest('.resourceCardActions')).toBeNull();
      }
      if (resourceType === 'KG_DOC') {
        expect(pendingButton.parentElement?.parentElement).toHaveClass('digitalEmployeeActions', 'knowledgeActions');
        expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
        expect(screen.queryByTestId('resource-menu-install')).toBeNull();
      }
      expect(screen.queryByText('resource.pendingAuthorization')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'resource.applyUse' })).toBeNull();
      expect(screen.queryByTestId('resource-menu-applyUse')).toBeNull();
      expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
      // disabled 按钮由外层容器接收悬浮，保留图标的无障碍名称但不显示常驻文案。
      fireEvent.mouseEnter(pendingButton.parentElement!);
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('resource.pendingAuthorization');
      await waitFor(() => expect(tooltip).toBeVisible());
    },
    lifecycleTestTimeout
  );

  it.each([
    ['SKILL', 'default', true],
    ['SKILL', 'default', false],
    ['SKILL', 'skillPoster', true],
    ['SKILL', 'skillPoster', false],
    ['KG_DOC', 'default', true],
    ['KG_DOC', 'default', false],
    ['TOOL', 'default', true],
    ['TOOL', 'default', false],
    ['DIG_EMPLOYEE', 'default', true],
    ['DIG_EMPLOYEE', 'default', false],
  ] as const)(
    'keeps the %s %s card action slots stable after confirmation, menu=%s',
    async (resourceType, variant, canEdit) => {
      const onApplyUse = jest.fn();
      const ApplyCard = () => {
        const [pending, setPending] = React.useState(false);
        return (
          <ResourceCard
            resourceType={resourceType}
            variant={variant}
            digitalEmployeeActionMode={resourceType === 'DIG_EMPLOYEE'}
            resource={{
              resourceId: 'skill-apply',
              resourceStatus: '2',
              hasUsePermission: false,
              canApplyUse: !pending,
              useApplyPending: pending,
              canEdit,
            }}
            actionConfig={{
              enableResourceLifecycle: true,
              onApplyUse: () => {
                onApplyUse();
                setPending(true);
              },
            }}
          />
        );
      };
      renderWithQueryClient(<ApplyCard />);
      const applyButton = screen.getByRole('button', { name: 'resource.applyUse' });
      const actions = applyButton.parentElement!;
      const actionCount = within(actions).getAllByRole('button').length;
      const editMenu = screen.queryByTestId('resource-menu-edit');
      fireEvent.click(applyButton);
      const confirm = await screen.findByRole('button', { name: 'common.confirm' });
      await act(async () => {
        fireEvent.click(confirm);
      });

      const pendingButton = await within(actions).findByRole('button', { name: 'resource.pendingAuthorization' });
      expect(onApplyUse).toHaveBeenCalledTimes(1);
      expect(pendingButton).toBeDisabled();
      expect(pendingButton).toHaveClass('ant-btn-circle');
      expect(pendingButton.parentElement?.parentElement).toBe(actions);
      expect(within(actions).getAllByRole('button')).toHaveLength(actionCount);
      expect(within(actions).queryByText('resource.pendingAuthorization')).not.toBeInTheDocument();
      fireEvent.click(pendingButton);
      expect(onApplyUse).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('resource-menu-edit')).toBe(editMenu);
    },
    lifecycleTestTimeout
  );

  it.each([
    { resourceStatus: '0' },
    { resourceStatus: '3' },
    { resourceStatus: '-1' },
    { resourceStatus: '2', hasUsePermission: true },
    { resourceStatus: '2', canApplyUse: false },
    { resourceStatus: '2', hiddenMenuItemKeys: ['applyUse'] },
    { resourceStatus: '2', resourceBacked: false, skillPath: '/skills/example' },
  ])('hides the resource center use application icon when unavailable: %j', (state) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        resource={{
          resourceId: 'skill-unavailable',
          resourceBizType: 'SKILL',
          hasUsePermission: false,
          canApplyUse: true,
          ...state,
        }}
        actionConfig={{ enableResourceLifecycle: true, hiddenMenuItemKeys: state.hiddenMenuItemKeys }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.applyUse' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-applyUse')).toBeNull();
  });

  it.each(['default', 'skillPoster'] as const)('opens installation from the %s skill icon only', (variant) => {
    const onCardClick = jest.fn();
    const targetContext = {
      mode: 'fixed' as const,
      digitalEmployeeId: 'employee-1',
      digitalEmployeeName: 'Employee',
    };
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant={variant}
        onCardClick={onCardClick}
        resource={{
          resourceId: 'skill-1',
          resourceName: 'Skill',
          resourceBizType: 'SKILL',
          hasUsePermission: true,
          canEdit: true,
          resourceStatus: '2',
        }}
        actionConfig={{ enableResourceLifecycle: true, installTargetContext: targetContext }}
      />
    );

    const installButton = screen.getByRole('button', { name: 'resource.installSkill' });
    expect(installButton).toHaveClass('ant-btn-circle');
    expect(within(installButton).getByTestId('icon-icon-a-Downloadxiazai')).toBeInTheDocument();
    expect(installButton.parentElement).toHaveClass('digitalEmployeeActions');
    // 下移仅应用于技能海报卡片，普通资源卡片保持原操作区布局。
    if (variant === 'skillPoster') {
      expect(installButton.parentElement).toHaveClass('skillPosterActions');
    } else {
      expect(installButton.parentElement).not.toHaveClass('skillPosterActions');
    }
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
    expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
    fireEvent.click(installButton);
    const dialog = screen.getByRole('dialog', { name: 'install-dialog' });
    expect(dialog).toHaveAttribute('data-resource-id', 'skill-1');
    expect(dialog).toHaveAttribute('data-target-context', JSON.stringify(targetContext));
    expect(onCardClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'close-install' }));
    expect(screen.queryByRole('dialog', { name: 'install-dialog' })).toBeNull();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it.each(['default', 'skillPoster'] as const)('hides the %s skill install icon when already installed', (variant) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant={variant}
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

    expect(screen.queryByRole('button', { name: 'resource.installSkill' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
  });

  it.each([
    { resourceStatus: '0' },
    { resourceStatus: '3' },
    { resourceStatus: '-1' },
    { resourceStatus: '2', canInstallToTarget: false },
    { resourceStatus: '2', hiddenMenuItemKeys: ['install'] },
    { resourceStatus: '2', resourceBacked: false, skillPath: '/skills/example' },
  ])('hides the skill install icon when installation is unavailable: %j', (state) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        resource={{
          resourceId: 'skill-1',
          resourceBizType: 'SKILL',
          hasUsePermission: true,
          ...state,
        }}
        actionConfig={{
          enableResourceLifecycle: true,
          canInstallToTarget: state.canInstallToTarget,
          hiddenMenuItemKeys: state.hiddenMenuItemKeys,
        }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.installSkill' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
  });

  it.each([
    ['SKILL', 'resource.installSkill'],
    ['KG_DOC', 'resource.installKnowledge'],
    ['TOOL', 'resource.installTool'],
  ])('opens target selection and prevents repeated installation while installing %s', (resourceType, installLabel) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType={resourceType}
        resource={{ resourceId: 'resource-1', resourceBizType: resourceType, hasUsePermission: true }}
      />
    );

    const installButton = screen.getByRole('button', { name: installLabel });
    expect(installButton).toHaveClass('cardPrimaryActionBtn');
    // 技能、知识和工具共用安装图标，入口仍保留原来的目标选择与防重复提交行为。
    expect(within(installButton).getByTestId('icon-icon-a-Downloadxiazai')).toHaveClass(
      'cardActionBtnIcon',
      'installActionIcon'
    );
    expect(within(installButton).queryByTestId('icon-icon-a-Addtianjia')).toBeNull();
    fireEvent.click(installButton);
    expect(screen.getByRole('dialog', { name: 'install-dialog' })).toHaveAttribute(
      'data-target-context',
      JSON.stringify({ mode: 'select' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'start-install' }));
    expect(screen.getByRole('button', { name: installLabel })).toBeDisabled();
  });

  // 工具列表类型与业务子类型都使用外露入口，兼容个人列表和当前员工的固定安装目标。
  it.each(
    ['TOOL', 'TOOLKIT', 'MCP', 'MCP_TOOL', 'AGENT'].flatMap((resourceBizType) =>
      [undefined, 'TOOL', resourceBizType].map((resourceType) => ({ resourceBizType, resourceType }))
    )
  )(
    'opens tool installation outside the menu for $resourceType / $resourceBizType',
    ({ resourceType, resourceBizType }) => {
      const onCardClick = jest.fn();
      const targetContext = { mode: 'fixed' as const, digitalEmployeeId: 'employee-1' };
      renderWithQueryClient(
        <ResourceCard
          resourceType={resourceType}
          onCardClick={onCardClick}
          resource={{
            resourceId: 'tool-1',
            resourceBizType,
            resourceStatus: '2',
            hasUsePermission: true,
            canEdit: true,
          }}
          actionConfig={{ enableResourceLifecycle: resourceType === 'TOOL', installTargetContext: targetContext }}
        />
      );

      const installButton = screen.getByRole('button', { name: 'resource.installTool' });
      expect(installButton).toHaveClass('ant-btn-circle');
      expect(installButton.parentElement).toHaveClass('digitalEmployeeActions', 'resourceCardActions');
      expect(screen.queryByTestId('resource-menu-install')).toBeNull();
      expect(screen.queryByRole('button', { name: 'resource.applyUse' })).toBeNull();
      expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
      fireEvent.click(installButton);
      const dialog = screen.getByRole('dialog', { name: 'install-dialog' });
      expect(dialog).toHaveAttribute('data-resource-id', 'tool-1');
      expect(dialog).toHaveAttribute('data-target-context', JSON.stringify(targetContext));
      expect(onCardClick).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'close-install' }));
      expect(screen.queryByRole('dialog', { name: 'install-dialog' })).toBeNull();
      expect(onCardClick).not.toHaveBeenCalled();
    }
  );

  it.each([
    { resourceStatus: '0' },
    { resourceStatus: '3' },
    { resourceStatus: '-1' },
    { resourceStatus: '2', canInstallToTarget: false },
    { resourceStatus: '2', hiddenMenuItemKeys: ['install'] },
    { resourceStatus: '2', installedResourceIds: new Set(['tool-1']) },
  ])('hides both tool installation entries when unavailable: %j', (state) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="TOOL"
        resource={{
          resourceId: 'tool-1',
          resourceBizType: 'TOOLKIT',
          resourceStatus: state.resourceStatus,
          hasUsePermission: true,
        }}
        actionConfig={{
          enableResourceLifecycle: true,
          canInstallToTarget: state.canInstallToTarget,
          hiddenMenuItemKeys: state.hiddenMenuItemKeys,
          installedResourceIds: state.installedResourceIds,
        }}
      />
    );
    expect(screen.queryByRole('button', { name: 'resource.installTool' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
  });

  it.each(['KG_DB', 'OBJECT', 'VIEW'])('keeps installation in the menu for authorized %s resources', (resourceType) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType={resourceType}
        resource={{ resourceId: 'resource-1', resourceBizType: resourceType, hasUsePermission: true }}
      />
    );

    expect(screen.getByTestId('resource-menu-install')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('resource-menu-install')).getByTestId('icon-icon-a-Downloadxiazai')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'resource.installSkill' })).toBeNull();
    fireEvent.click(screen.getByTestId('resource-menu-install'));
    expect(screen.getByRole('dialog', { name: 'install-dialog' })).toHaveAttribute('data-resource-id', 'resource-1');
  });

  it.each(['KG_DOC', 'KG_QA', 'KG_TERM', 'KG_DB'])(
    'opens installation from the circular %s knowledge action without opening card details',
    (resourceBizType) => {
      const onCardClick = jest.fn();
      const targetContext = { mode: 'fixed' as const, digitalEmployeeId: 'employee-1' };
      renderWithQueryClient(
        <ResourceCard
          resourceType="KG_DOC"
          onCardClick={onCardClick}
          resource={{
            resourceId: 'knowledge-1',
            resourceBizType,
            resourceStatus: '2',
            hasUsePermission: true,
            canEdit: true,
          }}
          actionConfig={{ enableResourceLifecycle: true, installTargetContext: targetContext }}
        />
      );

      const installButton = screen.getByRole('button', { name: 'resource.installKnowledge' });
      expect(installButton).toHaveClass('ant-btn-circle');
      expect(installButton.parentElement).toHaveClass('digitalEmployeeActions', 'knowledgeActions');
      expect(installButton.closest('.resourceCard')).toHaveClass('knowledgeCard');
      expect(screen.queryByTestId('resource-menu-install')).toBeNull();
      expect(screen.queryByRole('button', { name: 'resource.applyUse' })).toBeNull();
      expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
      fireEvent.click(installButton);
      expect(screen.getByRole('dialog', { name: 'install-dialog' })).toHaveAttribute('data-resource-id', 'knowledge-1');
      expect(screen.getByRole('dialog', { name: 'install-dialog' })).toHaveAttribute(
        'data-target-context',
        JSON.stringify(targetContext)
      );
      fireEvent.click(screen.getByRole('button', { name: 'close-install' }));
      expect(screen.queryByRole('dialog', { name: 'install-dialog' })).toBeNull();
      expect(onCardClick).not.toHaveBeenCalled();
    }
  );

  it.each(['KG_DOC', 'KG_DB', 'KG_QA', 'KG_TERM', 'TOOL', 'TOOLKIT', 'MCP', 'MCP_TOOL', 'AGENT', 'OBJECT', 'VIEW'])(
    'hides installation for %s resources without use permission, including pending applications',
    (resourceType) => {
      // 申请权限与目标管理权限均不能替代资源使用权限；接口缺少权限字段时也不展示安装。
      const states = [
        { hasUsePermission: false, canApplyUse: true, useApplyPending: false },
        { hasUsePermission: false, canApplyUse: false, useApplyPending: true },
        { hasUsePermission: undefined, canApplyUse: false, useApplyPending: false },
      ];
      for (const state of states) {
        const { unmount } = renderWithQueryClient(
          <ResourceCard
            resourceType={resourceType}
            resource={{
              resourceId: 'resource-1',
              resourceBizType: resourceType,
              resourceStatus: '2',
              hasManagePermission: true,
              ...state,
            }}
            actionConfig={{ enableResourceLifecycle: true, canInstallToTarget: true }}
          />
        );

        expect(screen.queryByTestId('resource-menu-install')).toBeNull();
        expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'resource.installTool' })).toBeNull();
        expect(screen.queryByRole('dialog', { name: 'install-dialog' })).toBeNull();
        if (state.canApplyUse) {
          expect(screen.getByRole('button', { name: 'resource.applyUse' })).toBeInTheDocument();
        } else if (state.useApplyPending) {
          expect(screen.getByRole('button', { name: 'resource.pendingAuthorization' })).toBeDisabled();
        }
        unmount();
      }
    }
  );

  it('hides install knowledge action when current digital employee already installed it', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="KG_DOC"
        resource={{
          resourceId: 'knowledge-1',
          resourceName: 'Knowledge',
          resourceBizType: 'KG_DOC',
          hasUsePermission: true,
        }}
        actionConfig={{
          installedResourceIds: new Set(['knowledge-1']),
        }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
  });

  it.each([
    { resourceStatus: '0' },
    { resourceStatus: '3' },
    { resourceStatus: '-1' },
    { resourceStatus: '2', hiddenMenuItemKeys: ['install'] },
  ])('hides the knowledge install icon when installation is unavailable: %j', (state) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="KG_DOC"
        resource={{ resourceId: 'knowledge-1', resourceBizType: 'KG_DOC', hasUsePermission: true, ...state }}
        actionConfig={{ enableResourceLifecycle: true, hiddenMenuItemKeys: state.hiddenMenuItemKeys }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
  });

  it('hides install action when the fixed digital employee is not manageable', () => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="KG_DOC"
        resource={{
          resourceId: 'knowledge-1',
          resourceName: 'Knowledge',
          resourceBizType: 'KG_DOC',
          hasUsePermission: true,
        }}
        actionConfig={{ canInstallToTarget: false }}
      />
    );

    expect(screen.queryByRole('button', { name: 'resource.installKnowledge' })).toBeNull();
    expect(screen.queryByTestId('resource-menu-install')).toBeNull();
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

  // 员工卡片保留独立申请按钮和管理操作，默认入口独立遵循后端 canSetDefault。
  it('keeps independent apply, default and management actions', () => {
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
    expect(screen.getByText('resource.setDefaultAssistant')).toBeInTheDocument();
  });

  // 有管理权限的员工可以设为默认，前端不重复要求 hasUsePermission。
  it.each([
    { hasUsePermission: false, canApplyUse: true, useApplyPending: true },
    { hasUsePermission: false, canApplyUse: false },
    { hasUsePermission: undefined, canApplyUse: false },
  ])('shows backend-permitted set default independently of use permission: %j', (permissions) => {
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

    expect(screen.getByText('resource.setDefaultAssistant')).toBeInTheDocument();
    expect(screen.queryByText('resource.applyUse')).toBeNull();
  });

  // 工具卡片统一使用圆形申请入口，无需另行启用生命周期操作。
  it('shows the tool apply icon without enabling lifecycle actions', () => {
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

    expect(screen.getByRole('button', { name: 'resource.applyUse' })).toBeEnabled();
    expect(screen.queryByText('resource.applyUse')).toBeNull();
  });

  // 管理员工的个人/企业页签无需显式开启默认入口，数字员工和员工组均按后端权限展示。
  it.each([
    ['personal', '001'],
    ['personal', '017'],
    ['enterprise', '001'],
    ['enterprise', '017'],
  ] as const)('shows set default for a permitted %s / %s employee without page opt-in', (ownerType, agentType) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-other-page',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType,
          agentType,
          hasUsePermission: true,
          canSetDefault: true,
          isDefault: false,
        }}
        actionConfig={{ scene: ownerType }}
      />
    );
    expect(screen.getByText('resource.setDefaultAssistant')).toBeTruthy();
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

  // 默认身份可来自列表字段或全局默认员工 ID，两种来源都不能覆盖后端允许设置的权限。
  it.each([
    { resourceId: 'default-flag-employee', isDefault: true },
    { resourceId: 'default-agent-1', isDefault: false },
  ])('shows set default for a permitted current default employee: %j', (identity) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          ...identity,
          resourceName: 'Default Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          hasUsePermission: true,
          canSetDefault: true,
        }}
      />
    );

    expect(screen.getByText('resource.setDefaultAssistant')).toBeTruthy();
    expect(screen.getByText('resource.defaultDigitalEmployee')).toBeTruthy();
  });

  it.each([false, undefined])('hides set default when the backend does not grant permission: %s', (canSetDefault) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-no-default-permission',
          resourceName: 'Unavailable Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          hasUsePermission: true,
          canApplyUse: false,
          canSetDefault,
          isDefault: false,
        }}
      />
    );

    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  it.each<[string | undefined, string | undefined, string, boolean]>([
    ['DIG_EMPLOYEE', undefined, '001', false],
    [undefined, 'DIG_EMPLOYEE', '017', true],
  ])('uses compact employee styling for %s / %s / %s', (resourceBizType, resourceType, agentType, enableFavorites) => {
    const { container } = renderWithQueryClient(
      <ResourceCard
        resourceType={resourceType}
        enableFavorites={enableFavorites}
        resource={{ resourceId: 'compact-employee', resourceBizType, agentType, favoriteCount: 1 }}
      />
    );

    expect(container.querySelector('.resourceCard')).toHaveClass('digitalEmployeeCard');
    if (enableFavorites) {
      expect(container.querySelector('.resourceCard')).toHaveClass('favoriteCard');
    }
  });

  it.each(['KG_DOC', 'TOOLKIT', 'SKILL'])('keeps compact employee styling scoped away from %s', (resourceBizType) => {
    const { container } = renderWithQueryClient(
      <ResourceCard resource={{ resourceId: 'other-resource', resourceBizType }} />
    );

    expect(container.querySelector('.resourceCard')).not.toHaveClass('digitalEmployeeCard');
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
    (getSkillPublicationPermissions as jest.Mock).mockReset().mockResolvedValue({ canPublishToEnterprise: true });
    emit.mockReset();
    jest.spyOn(globalHook, 'default').mockReturnValue({ EventEmitter: { emit } } as any);
  });

  afterEach(() => {
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

  it.each([
    { alreadyExists: false, resourceName: 'Personal skill（企业）' },
    { alreadyExists: true, resourceName: 'Personal skill（企业）' },
    { alreadyExists: false, resourceName: 'Personal skill (Enterprise)' },
    { alreadyExists: true, resourceName: 'Personal skill (Enterprise)' },
  ])(
    'opens the returned copy: $resourceName (existing=$alreadyExists)',
    async ({ alreadyExists, resourceName }) => {
      const onEnterpriseSkillDetail = jest.fn();
      const publishedSkill = { ...enterpriseSkill, resourceName };
      (publishSkillToEnterprise as jest.Mock).mockResolvedValue({ resource: publishedSkill, alreadyExists });
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
        await screen.findByText(
          alreadyExists ? 'resource.enterpriseSkillExists' : 'resource.publishToEnterpriseSuccess'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
      expect(screen.getByText('Personal skill')).toBeInTheDocument();
      expect(emit).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByText('resource.viewEnterpriseSkill'));
      expect(onEnterpriseSkillDetail).toHaveBeenCalledWith(publishedSkill);
      expect(personalSkill.ownerType).toBe('personal');
    },
    lifecycleTestTimeout
  );

  it.each(['Personal skill（企业）', 'Personal skill (Enterprise)'])(
    'renders the enterprise skill name returned by the server: %s',
    (resourceName) => {
      renderWithQueryClient(<ResourceCard resource={{ ...enterpriseSkill, resourceName }} />);
      expect(screen.getByText(resourceName)).toBeInTheDocument();
    }
  );

  // 此流程同时创建确认弹层、消息和依赖提醒，沿用发布用例预算，并限定按钮查询范围。
  it(
    'shows pending review and a non-blocking personal dependency notice',
    async () => {
      (publishSkillToEnterprise as jest.Mock).mockResolvedValue({
        resource: { ...enterpriseSkill, resourceStatus: 4 },
        alreadyExists: false,
        personalDependencies: [{ resourceId: 'knowledge-1', resourceName: '个人知识库', resourceBizType: 'KG_DOC' }],
      });
      renderWithQueryClient(
        <ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: true }} />
      );
      await act(async () => {
        fireEvent.click(screen.getByText('resource.publishToEnterprise'));
      });
      const confirmation = (await screen.findByText('resource.publishToEnterpriseConfirm')).closest('.ant-popover')!;
      await act(async () => {
        fireEvent.click(within(confirmation).getByRole('button', { name: 'common.confirm', hidden: true }));
      });
      expect(await screen.findByText('resource.enterpriseSkillPending')).toBeInTheDocument();
      const dependencyDialog = (await screen.findByText('resource.enterprisePersonalDependenciesWarning')).closest(
        '[role="dialog"]'
      )!;
      expect(within(dependencyDialog).getByText('个人知识库')).toBeInTheDocument();
      expect(within(dependencyDialog).getByText('resource.enterprisePersonalDependenciesWarning')).toBeInTheDocument();
      expect(publishSkillToEnterprise).toHaveBeenCalledTimes(1);
      expect(screen.getByText('resource.skillPublicationProgress')).toBeInTheDocument();
      expect(screen.queryByText('resource.viewEnterpriseSkill')).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(dependencyDialog).getByRole('button', { name: 'common.confirm', hidden: true }));
      });
    },
    lifecycleTestTimeout
  );

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

  it(
    'reports failures without showing a success message',
    async () => {
      const success = jest.spyOn(message, 'success');
      (publishSkillToEnterprise as jest.Mock).mockRejectedValue('Publication permission revoked');
      renderWithQueryClient(
        <ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: true }} />
      );
      await act(async () => {
        fireEvent.click(screen.getByText('resource.publishToEnterprise'));
      });
      const confirmation = (await screen.findByText('resource.publishToEnterpriseConfirm')).closest('.ant-popover')!;
      await act(async () => {
        fireEvent.click(within(confirmation).getByRole('button', { name: 'common.confirm', hidden: true }));
      });
      expect(await screen.findByText('Publication permission revoked')).toBeInTheDocument();
      expect(success).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
    },
    lifecycleTestTimeout
  );

  it('shows manifest dependency rejection and keeps publication available for retry', async () => {
    const success = jest.spyOn(message, 'success');
    const reason = '无法发布到企业：个人工具「订单查询」（ID：2001）；个人知识「产品资料」（ID：3001）。';
    (publishSkillToEnterprise as jest.Mock).mockRejectedValue(reason);
    renderWithQueryClient(<ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: true }} />);
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));

    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
    expect(screen.getByText('resource.retrySkillPublication')).toBeInTheDocument();
  });

  it.each<[number, string]>([
    [4, 'resource.skillPublicationProgress'],
    [5, 'resource.skillPublicationReviewResult'],
    [2, 'resource.skillPublicationResult'],
    [3, 'resource.skillPublicationResult'],
  ])('keeps a read-only publication entry after list reload: %s', async (resourceStatus, label) => {
    const publication = { ...enterpriseSkill, resourceStatus };
    (getSkillPublicationPermissions as jest.Mock).mockResolvedValue({
      canPublishToEnterprise: true,
      skillPublication: publication,
    });
    const confirm = jest.spyOn(Modal, 'confirm').mockImplementation(jest.fn());
    renderWithQueryClient(
      <ResourceCard
        resource={{ ...personalSkill, skillPublication: publication }}
        actionConfig={{ enablePublishToEnterprise: true }}
      />
    );
    fireEvent.click(screen.getByText(label));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(getSkillPublicationPermissions).toHaveBeenCalledWith('source-skill');
    expect(publishSkillToEnterprise).not.toHaveBeenCalled();
  });

  it('recovers the pending entry when the publish response was lost after submission', async () => {
    (publishSkillToEnterprise as jest.Mock).mockRejectedValue({ response: { data: { msg: 'Network interrupted' } } });
    (getSkillPublicationPermissions as jest.Mock).mockResolvedValue({
      canPublishToEnterprise: true,
      skillPublication: { ...enterpriseSkill, resourceStatus: 4 },
    });
    renderWithQueryClient(<ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: true }} />);
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(await screen.findByText('Network interrupted')).toBeInTheDocument();
    expect(await screen.findByText('resource.skillPublicationProgress')).toBeInTheDocument();
    expect(publishSkillToEnterprise).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated confirmation while publication is pending', async () => {
    let finish!: (value: any) => void;
    (publishSkillToEnterprise as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    renderWithQueryClient(<ResourceCard resource={personalSkill} actionConfig={{ enablePublishToEnterprise: true }} />);
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    expect(screen.queryAllByText('common.processing')).toHaveLength(0);
    const confirm = await screen.findByRole('button', { name: 'common.confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(publishSkillToEnterprise).toHaveBeenCalledTimes(1);
    // 发布中菜单和全局提示同时显示处理文案，限定到卡片内部验证。
    const card = screen.getByText('Personal skill').closest('.resourceCard') as HTMLElement;
    expect(await within(card).findByText('common.processing')).toBeInTheDocument();
    const skillTitle = screen.getByText('Personal skill');
    expect(skillTitle).toBeInTheDocument();
    finish({ resource: enterpriseSkill, alreadyExists: false });
    expect(await screen.findByText('resource.publishToEnterpriseSuccess')).toBeInTheDocument();
    expect(screen.getByText('Personal skill')).toBe(skillTitle);
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
  });
});

describe('digital employee publication entry', () => {
  it('keeps preparation feedback visible and blocks duplicate clicks until navigation is ready', async () => {
    let finish!: () => void;
    (openEmployeePublication as jest.Mock).mockClear().mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const loading = jest.spyOn(message, 'loading').mockImplementation(jest.fn());
    const destroy = jest.spyOn(message, 'destroy').mockImplementation(jest.fn());
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
        }}
      />
    );
    const entry = screen.getByText('resource.publishToEnterprise');
    fireEvent.click(entry);
    fireEvent.click(entry);
    expect(openEmployeePublication).toHaveBeenCalledTimes(1);
    expect(loading).toHaveBeenCalledWith(
      expect.objectContaining({ content: '正在准备发布申请，请稍候…', duration: 0 })
    );
    expect(destroy).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    expect(destroy).toHaveBeenCalledWith('employee-publication-open-10');
    loading.mockRestore();
    destroy.mockRestore();
  });
  it('displays the concrete server message when draft preparation rejects a string', async () => {
    (openEmployeePublication as jest.Mock).mockRejectedValueOnce('仅在用数字员工支持发起发布或更新');
    const error = jest.spyOn(message, 'error').mockImplementation(jest.fn());
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
        }}
      />
    );
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    await waitFor(() => expect(error).toHaveBeenCalledWith('仅在用数字员工支持发起发布或更新'));
    error.mockRestore();
  });
  it.each([
    [undefined, 'resource.publishToEnterprise'],
    ['DRAFT', '继续发布'],
    ['PENDING', '查看发布进度'],
    ['APPLYING', '查看发布进度'],
    ['REJECTED', '查看审核结果'],
    ['WITHDRAWN', '查看发布申请'],
    ['FAILED', '查看发布结果'],
    ['PUBLISHED', '发布更新'],
  ])('shows the entry for %s and opens the existing request', async (status, label) => {
    (openEmployeePublication as jest.Mock).mockClear().mockResolvedValue(undefined);
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: status,
        }}
      />
    );
    fireEvent.click(screen.getByText(label!));
    await waitFor(() => {
      if (status === 'PUBLISHED') expect(openEmployeePublication).toHaveBeenCalledWith('10', 'publishUpdate');
      else expect(openEmployeePublication).toHaveBeenCalledWith('10');
    });
  });
  it('views a published record without preparing another update', async () => {
    (openEmployeePublication as jest.Mock).mockClear().mockResolvedValue(undefined);
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: 'PUBLISHED',
        }}
      />
    );
    fireEvent.click(screen.getByText('查看发布记录'));
    await waitFor(() => expect(openEmployeePublication).toHaveBeenCalledWith('10'));
    expect(openEmployeePublication).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['DRAFT', '继续发布更新'],
    ['PENDING', '查看更新进度'],
  ])('identifies a %s update candidate separately from an initial publication', (status, label) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: true,
          employeePublicationStatus: status,
          employeePublicationUpdate: true,
        }}
      />
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  it('only offers publication when the backend allows it', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          canPublishEmployee: false,
        }}
      />
    );
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
  });
  // 企业管理页沿用后端权限，官方副本标志不能再次隐藏作者已获准的授权和下架入口。
  it('shows authorization and shelf actions for a manageable published enterprise employee', () => {
    const onAuth = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'published-employee',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'enterprise',
          resourceStatus: '2',
          officialPublication: true,
          hasManagePermission: true,
          canEdit: true,
          canManageAuth: true,
          canUseAuth: true,
          canOffShelf: true,
        }}
        actionConfig={{ onAuth, enableDigitalEmployeeLifecycle: true }}
      />
    );
    expect(screen.getByText('common.editInfo')).toBeInTheDocument();
    expect(screen.getByText('resource.unShelfData')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.manageAuthorization'));
    fireEvent.click(screen.getByText('common.useAuthorization'));
    expect(onAuth.mock.calls).toEqual([['mgrAuth'], ['useAuth']]);
  });

  it('opens an official copy in its ordinary editor without preparing a publication', async () => {
    (openEmployeePublication as jest.Mock).mockReset();
    const onEdit = jest.fn();
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: '10',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'enterprise',
          canEdit: true,
          officialPublication: true,
        }}
        actionConfig={{ onEdit }}
      />
    );
    fireEvent.click(screen.getByText('common.editInfo'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(openEmployeePublication).not.toHaveBeenCalled();
  });
});

// 员工和员工组共用卡片，顺序由菜单生成逻辑保证；隐藏授权仍消费后端权限字段。
it.each(['001', '017'])(
  'places employee publication immediately before deregistration for agent type %s',
  (agentType) => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'personal-employee',
          resourceBizType: 'DIG_EMPLOYEE',
          ownerType: 'personal',
          resourceStatus: '2',
          agentType,
          canSetDefault: true,
          hasUsePermission: true,
          canEdit: true,
          canPublishEmployee: true,
          canDelete: true,
          canUseAuth: false,
          canManageAuth: false,
        }}
        actionConfig={{ enableDigitalEmployeeDelete: true }}
      />
    );
    expect(screen.getAllByTestId(/^resource-menu-/).map((item) => item.getAttribute('data-testid'))).toEqual([
      'resource-menu-setDefaultAssistant',
      'resource-menu-edit',
      'resource-menu-publishEmployee',
      'resource-menu-deleteData',
    ]);
  }
);

it.each(['SKILL', 'KG_DOC', 'TOOLKIT'])(
  'hides authorization for a personal %s when the backend returns false while preserving editing',
  (resourceBizType) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType={resourceBizType}
        resource={{
          resourceId: 'personal-resource',
          resourceBizType,
          ownerType: 'personal',
          resourceStatus: '2',
          hasManagePermission: true,
          hasUsePermission: true,
          canEdit: true,
          canManageAuth: false,
          canUseAuth: false,
        }}
      />
    );
    expect(screen.queryByTestId('resource-menu-authorize')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resource-menu-use')).not.toBeInTheDocument();
    expect(screen.getByTestId('resource-menu-edit')).toBeInTheDocument();
  }
);

it.each(['inner', 'custom', 'workspace'])(
  'shows export for usable %s skills without management permissions',
  (skillType) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        actionConfig={{ enableSkillExport: true }}
        resource={{
          resourceId: 'export-skill',
          resourceName: 'Export skill',
          resourceBizType: 'SKILL',
          skillType,
          ...(skillType === 'workspace' ? { resourceBacked: false, skillPath: '/skills/export-skill' } : {}),
          hasUsePermission: true,
          canEdit: false,
          canDelete: false,
          canManageAuth: false,
        }}
      />
    );
    expect(
      within(screen.getByTestId('resource-menu-exportSkill')).getByText('resource.skillExport.single')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resource.skillExport.single/ })).not.toBeInTheDocument();
  }
);

it.each(
  ['inner', 'custom', 'workspace'].flatMap((skillType) =>
    [false, undefined].map((hasUsePermission) => ({ skillType, hasUsePermission }))
  )
)(
  'hides export for $skillType skills without explicit use permission: $hasUsePermission',
  ({ skillType, hasUsePermission }) => {
    renderWithQueryClient(
      <ResourceCard
        resourceType="SKILL"
        variant="skillPoster"
        actionConfig={{ enableSkillExport: true }}
        resource={{
          resourceId: 'export-skill',
          resourceBizType: 'SKILL',
          skillType,
          ...(skillType === 'workspace' ? { resourceBacked: false, skillPath: '/skills/export-skill' } : {}),
          hasUsePermission,
          // 能编辑或管理使用授权，不代表本人有技能使用权限。
          canEdit: true,
          canManageAuth: true,
          canUseAuth: true,
        }}
      />
    );
    expect(screen.queryByTestId('resource-menu-exportSkill')).not.toBeInTheDocument();
    expect(screen.queryByText('resource.skillExport.single')).not.toBeInTheDocument();
  }
);

it('updates the single export entry when skill use permission changes', () => {
  const queryClient = new QueryClient();
  const renderCard = (hasUsePermission: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ResourceCard
        resourceType="SKILL"
        actionConfig={{ enableSkillExport: true }}
        resource={{ resourceId: 'export-skill', resourceBizType: 'SKILL', hasUsePermission }}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(renderCard(false));
  expect(screen.queryByTestId('resource-menu-exportSkill')).not.toBeInTheDocument();
  rerender(renderCard(true));
  expect(screen.getByTestId('resource-menu-exportSkill')).toBeInTheDocument();
  rerender(renderCard(false));
  expect(screen.queryByTestId('resource-menu-exportSkill')).not.toBeInTheDocument();
});

describe('workspace skill enterprise publication', () => {
  const workspaceSkill = {
    resourceId: 'WORKSPACE_SKILL:/skills/example',
    resourceName: 'Workspace skill',
    resourceBizType: 'SKILL',
    resourceBacked: false,
    skillPath: '/skills/example',
  };
  const actionConfig = {
    enablePublishToEnterprise: true,
    canManageWorkspaceSkill: true,
    hiddenMenuItemKeys: ['share'],
  };
  const emit = jest.fn();

  beforeEach(() => {
    emit.mockReset();
    jest.spyOn(globalHook, 'default').mockReturnValue({ EventEmitter: { emit } } as any);
    (checkWorkspaceSkillShareConflicts as jest.Mock).mockReset().mockResolvedValue({ updatedItems: [] });
    (resourceizeWorkspaceSkill as jest.Mock).mockReset().mockResolvedValue({
      items: [{ success: true, resourceId: 'personal-source' }],
    });
    (publishSkillToEnterprise as jest.Mock).mockReset().mockResolvedValue({
      resource: { resourceId: 'enterprise-copy' },
      alreadyExists: false,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('restores the current employee panel after closing a personal workspace skill card detail', async () => {
    (queryWorkspaceSkillDetail as jest.Mock).mockResolvedValue({ skillName: 'fws4', skillDesc: 'Personal skill' });
    const onCardClick = jest.fn();
    const Host = () => {
      const panels = useDetailPanelState();
      React.useEffect(() => {
        panels.openDetailPanel(<input aria-label="employee skill search" defaultValue="saved search" />);
      }, [panels.openDetailPanel]);
      return (
        <SiderContentContext.Provider
          value={{
            siderContentWidth: 240,
            setSiderContentWidth: jest.fn(),
            setDetailPanel: panels.openDetailPanel,
            clearDetailPanel: panels.clearDetailPanel,
            openTemporaryDetailPanel: panels.openTemporaryDetailPanel,
          }}
        >
          <ResourceCard
            resource={{ ...workspaceSkill, personalWorkspace: true }}
            resourceType="SKILL"
            onCardClick={onCardClick}
          />
          <div data-testid="right-panel">
            <DetailPanelContent {...panels} />
          </div>
        </SiderContentContext.Provider>
      );
    };
    renderWithQueryClient(<Host />);
    const originalSearch = screen.getByRole('textbox', { name: 'employee skill search' });
    fireEvent.click(screen.getByText('Workspace skill'));
    expect((await screen.findAllByText('fws4')).length).toBeGreaterThan(0);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(originalSearch).not.toBeVisible();
    fireEvent.click(within(screen.getByTestId('right-panel')).getByRole('button'));
    expect(screen.getByRole('textbox', { name: 'employee skill search' })).toBe(originalSearch);
    expect(originalSearch).toHaveValue('saved search');
    expect(queryWorkspaceSkillDetail).toHaveBeenCalledWith({
      skillPath: '/skills/example',
      personalWorkspace: true,
    });
  });

  it.each([
    { hiddenMenuItemKeys: ['share', 'publishToEnterprise'] },
    { canManageWorkspaceSkill: false },
    { enablePublishToEnterprise: false },
  ])('hides publication for browsing or insufficient capability: %j', (overrides) => {
    renderWithQueryClient(
      <ResourceCard resource={workspaceSkill} resourceType="SKILL" actionConfig={{ ...actionConfig, ...overrides }} />
    );
    expect(screen.queryByText('common.share')).not.toBeInTheDocument();
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    expect(screen.getByText('common.detail')).toBeInTheDocument();
  });

  it('resourceizes after confirmation and publishes with the real ID without reloading', async () => {
    renderWithQueryClient(<ResourceCard resource={workspaceSkill} resourceType="SKILL" actionConfig={actionConfig} />);
    expect(screen.queryByText('common.share')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    expect(resourceizeWorkspaceSkill).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(publishSkillToEnterprise).toHaveBeenCalledWith('personal-source'));
    expect(resourceizeWorkspaceSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillPath: '/skills/example', overwriteConfirmed: false })
    );
    expect(await screen.findByText('resource.publishToEnterpriseSuccess')).toBeInTheDocument();
    expect(screen.queryByText('resource.publishToEnterprise')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace skill')).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
  });

  it('publishes a personal directory without sending the default employee or user code', async () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{ ...workspaceSkill, personalWorkspace: true }}
        resourceType="SKILL"
        actionConfig={actionConfig}
      />
    );
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(publishSkillToEnterprise).toHaveBeenCalledWith('personal-source'));
    expect(checkWorkspaceSkillShareConflicts).toHaveBeenCalledWith({
      skillPath: '/skills/example',
      personalWorkspace: true,
    });
    expect(resourceizeWorkspaceSkill).toHaveBeenCalledWith({
      skillPath: '/skills/example',
      personalWorkspace: true,
      overwriteConfirmed: false,
    });
  });

  it('keeps the entry and does not publish when resourceization fails', async () => {
    (resourceizeWorkspaceSkill as jest.Mock).mockResolvedValue({ items: [{ success: false }] });
    renderWithQueryClient(<ResourceCard resource={workspaceSkill} resourceType="SKILL" actionConfig={actionConfig} />);
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    expect(await screen.findByText('common.operationFailed')).toBeInTheDocument();
    expect(publishSkillToEnterprise).not.toHaveBeenCalled();
    expect(screen.getByText('resource.publishToEnterprise')).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not resourceize or publish when the user cancels a name conflict', async () => {
    (checkWorkspaceSkillShareConflicts as jest.Mock).mockResolvedValue({
      updatedItems: [{ resourceCode: 'example', resourceName: 'Existing skill' }],
    });
    renderWithQueryClient(<ResourceCard resource={workspaceSkill} resourceType="SKILL" actionConfig={actionConfig} />);
    fireEvent.click(screen.getByText('resource.publishToEnterprise'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryAllByText('common.processing')).toHaveLength(0));
    expect(resourceizeWorkspaceSkill).not.toHaveBeenCalled();
    expect(publishSkillToEnterprise).not.toHaveBeenCalled();
    expect(screen.getByText('resource.publishToEnterprise')).toBeInTheDocument();
  });
});
