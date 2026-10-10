import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PublicationDetail } from '@/service/employeePublication';
import ResourceAvailabilityList from './ResourceAvailabilityList';
import ResourceSummary from './ResourceSummary';
import UpdateTargetNotice from './UpdateTargetNotice';
import PublicationLoading from './Loading';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getDvaApp: jest.fn(),
  useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));
afterEach(cleanup);

it.each([
  ['zh-CN', '技能', '生成企业技能副本', '尚未确认，沿用原授权范围'],
  ['en-US', 'Skill', 'Create enterprise skill copy', 'Unconfirmed; existing permissions apply'],
] as const)('localizes resource types, actions and availability fallbacks in %s', (locale, type, action, scope) => {
  mockLocale = locale;
  const { container } = render(
    <ResourceAvailabilityList
      dependencies={[{ resourceId: '1', name: 'Example skill', resourceType: 'SKILL', action: 'COPY_SKILL' }]}
    />
  );
  expect(screen.getByText(type)).toBeInTheDocument();
  expect(screen.getByText(action)).toBeInTheDocument();
  expect(screen.getByText(scope)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/employeePublication\./);
});

it('localizes summary counts and refreshes expanded content after switching languages', () => {
  mockLocale = 'zh-CN';
  const dependencies = [
    { resourceId: '1', name: 'Example knowledge', resourceType: 'KG_DOC', action: 'OMIT_RESOURCE' },
  ];
  const ui = <ResourceSummary dependencies={dependencies} onDownloadSkill={jest.fn()} />;
  const { rerender } = render(ui);
  expect(screen.getByText('1 项不会带入')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开说明' }));
  mockLocale = 'en-US';
  rerender(<ResourceSummary dependencies={dependencies} onDownloadSkill={jest.fn()} />);
  expect(screen.getByText('Excluded resources: 1')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Excluded from the new digital employee (1)' })).toBeInTheDocument();
  expect(screen.getByText('Unavailable in the new enterprise employee')).toBeInTheDocument();
  expect(screen.queryByText('1 项不会带入')).not.toBeInTheDocument();
});

it('localizes update target warnings and preserves the recheck action', () => {
  mockLocale = 'en-US';
  const refresh = jest.fn();
  const detail = {
    updateTarget: { resourceId: '20', name: 'Official employee', changed: true, fromPersonal: true },
  } as PublicationDetail;
  render(<UpdateTargetNotice detail={detail} onRefresh={refresh} />);
  expect(
    screen.getByText('The official employee configuration has changed. Please confirm again.')
  ).toBeInTheDocument();
  expect(screen.getByText('Official employee to update: Official employee')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Compare with official configuration again' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('localizes loading guidance and the return action', () => {
  mockLocale = 'en-US';
  render(<PublicationLoading title="Loading configuration" onBack={jest.fn()} />);
  expect(screen.getByText('Please wait. The page will appear when loading completes.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to employee list' })).toBeInTheDocument();
});
