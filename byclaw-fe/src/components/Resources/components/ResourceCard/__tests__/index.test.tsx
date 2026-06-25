jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
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
});
