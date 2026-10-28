import { fireEvent, render, screen } from '@testing-library/react';
import EmployeeOrganizationMeta from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'digitalEmployees.audienceOrganizations': '所属组织',
        'digitalEmployees.audienceOrganizations.unset': '未设置组织',
        'employeePublication.audience.all': '全公司',
      }[id] || id),
  }),
}));

it('shows two organizations plus a count and reveals the complete audience on hover', async () => {
  render(
    <EmployeeOrganizationMeta
      organizations={[
        { orgId: '10', orgName: '研发与交付中心' },
        { orgId: '20', orgName: '中企研' },
        { orgId: '30', orgName: '市场部' },
      ]}
    />
  );
  expect(screen.getByText('所属组织：')).toBeInTheDocument();
  const names = screen.getByText('研发与交付中心、中企研');
  expect(screen.getByText('+1')).toBeInTheDocument();
  expect(screen.queryByText('市场部')).not.toBeInTheDocument();
  fireEvent.mouseOver(names);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('研发与交付中心、中企研、市场部');
});

it('uses the localized all-company label', () => {
  render(<EmployeeOrganizationMeta organizations={[{ orgId: '-1', orgName: 'all' }]} />);
  expect(screen.getByText('全公司')).toBeInTheDocument();
  expect(screen.queryByText('all')).not.toBeInTheDocument();
});

it.each([undefined, []])('shows unset when no audience is available: %s', (organizations) => {
  render(<EmployeeOrganizationMeta organizations={organizations} />);
  expect(screen.getByText('未设置组织')).toBeInTheDocument();
  expect(screen.queryByText('全公司')).not.toBeInTheDocument();
});
