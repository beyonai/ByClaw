import { act, fireEvent, render, screen } from '@testing-library/react';
import ResourceCitation from '@/components/Resources/components/ResourceCitation';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { ResourceType } from '../../utils/constants';
import ResourceTabs from '../resourceTabs';
import ResourceTabsCompact from '../resourceTabsCompact';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useNavigate: () => jest.fn(),
  useSelector: (selector: (state: any) => unknown) => selector({ user: { userInfo: { userCode: 'test-user' } } }),
}));

jest.mock('@/hooks/useGlobal', () => () => ({ agentInfo: {}, EventEmitter: {} }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));
jest.mock('@/service/auth', () => ({
  getDcSystemConfigListByStandType: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/pages/manager/service/resources', () => ({
  queryDigEmployeeRelResourceAuth: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock('@/components/Resources/components/ResourceCitation', () =>
  jest.fn(({ resourceType, onSelect }: any) => (
    <button type="button" onClick={() => onSelect({ resourceId: 'skill-1', resourceName: 'Test skill' })}>
      {resourceType} result
    </button>
  ))
);

describe.each([
  { name: 'standard panel', Component: ResourceTabs, extraProps: {} },
  { name: 'compact panel', Component: ResourceTabsCompact, extraProps: {} },
  {
    name: 'plus menu skill panel',
    Component: ResourceTabsCompact,
    extraProps: { onlyTab: 'skill', hideTabBar: true },
  },
])('$name skill availability', ({ Component, extraProps }) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['commercial', 'openSource'])('allows selecting the employee skill in %s', async (paramValue) => {
    jest.mocked(getDcSystemConfig).mockResolvedValue({ paramValue });
    const onSelect = jest.fn();

    await act(async () => {
      render(<Component open agentId="123" agentIds="123" showSkillTab onSelect={onSelect} {...extraProps} />);
    });

    fireEvent.click(screen.getByRole('button', { name: 'SKILL result' }));
    expect(onSelect).toHaveBeenCalledWith({ resourceId: 'skill-1', resourceName: 'Test skill' }, ResourceType.SKILL);
    expect(
      jest
        .mocked(ResourceCitation)
        .mock.calls.some(
          ([props]) => props.resourceType === 'SKILL' && props.agentId === '123' && props.agentIds === '123'
        )
    ).toBe(true);
  });

  it('shows skills while the brand configuration is pending and after it resolves to commercial', async () => {
    let resolveBrand!: (value: any) => void;
    jest.mocked(getDcSystemConfig).mockReturnValue(
      new Promise((resolve) => {
        resolveBrand = resolve;
      })
    );

    await act(async () => {
      render(<Component open agentId="123" showSkillTab onSelect={jest.fn()} {...extraProps} />);
    });
    expect(screen.getByRole('button', { name: 'SKILL result' })).toBeVisible();

    await act(async () => {
      resolveBrand({ paramValue: 'commercial' });
    });
    expect(screen.getByRole('button', { name: 'SKILL result' })).toBeVisible();
  });
});
