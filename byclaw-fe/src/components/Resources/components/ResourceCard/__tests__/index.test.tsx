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
  queryResourceOperationPermissions: jest.fn(),
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
import { render, screen } from '@testing-library/react';
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

  it('uses default digital employee tag style when the digital employee is default', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-1',
          resourceName: 'Default Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          isDefault: true,
          tagName: 'Custom Tag',
        }}
      />
    );

    expect(screen.getByText('resource.defaultDigitalEmployee').parentElement).toHaveClass('digitalEmployeeDefaultTag');
  });

  it('keeps permission-based actions alongside apply use for a digital employee', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-apply',
          resourceName: 'Apply Employee',
          resourceBizType: 'DIG_EMPLOYEE',
          canApplyUse: true,
          canEdit: true,
          canManageAuth: true,
        }}
        actionConfig={{ onApplyUse: jest.fn(), onEdit: jest.fn(), onAuth: jest.fn() }}
      />
    );

    expect(screen.getByText('resource.applyUse')).toBeTruthy();
    expect(screen.getByText('common.editInfo')).toBeTruthy();
    expect(screen.getByText('common.manageAuthorization')).toBeTruthy();
    expect(screen.queryByText('resource.setDefaultAssistant')).toBeNull();
  });

  it('shows set default for a usable non-default digital employee', () => {
    renderWithQueryClient(
      <ResourceCard
        resource={{
          resourceId: 'employee-default',
          resourceName: 'Usable Employee',
          resourceBizType: 'DIG_EMPLOYEE',
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
          tagName: 'Personal Tag',
        }}
      />
    );

    expect(screen.getByText('Personal Tag').parentElement).toHaveClass('digitalEmployeePersonalTag');
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
