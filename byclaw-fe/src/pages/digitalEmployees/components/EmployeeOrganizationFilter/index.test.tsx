import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { getPublicationScopeOptions } from '@/service/employeePublication';
import EmployeeOrganizationFilter from './index';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('@/service/employeePublication', () => ({ getPublicationScopeOptions: jest.fn() }));

const options = [
  { orgId: '10', parentOrgId: '0', orgName: '研发中心' },
  { orgId: '11', parentOrgId: '10', orgName: '前端组' },
  { orgId: '20', parentOrgId: '0', orgName: '市场部' },
];
const changed = jest.fn();
const Harness = () => {
  const [value, setValue] = useState({});
  return (
    <EmployeeOrganizationFilter
      value={value}
      onChange={(next) => {
        changed(next);
        setValue((current) => ({ ...current, ...next }));
      }}
    />
  );
};
const choose = async (label: string) => {
  const node = (await screen.findByText(label)).closest('.ant-select-tree-treenode');
  fireEvent.click(node!.querySelector('.ant-select-tree-checkbox')!);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPublicationScopeOptions).mockResolvedValue(options);
});

it('supports searching, independent multi-selection, descendants and separate company filtering', async () => {
  render(<Harness />);
  const input = screen.getByRole('combobox');
  const descendants = screen.getByRole('checkbox', { name: 'digitalEmployees.audienceFilter.includeDescendants' });
  expect(descendants).toBeChecked();
  expect(descendants).toBeDisabled();
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.mouseDown(input);
  await choose('研发中心');
  expect(changed).toHaveBeenLastCalledWith({ audienceScopeMode: 'ORGS', audienceOrgIds: ['10'] });
  expect(descendants).not.toBeDisabled();
  fireEvent.click(descendants);
  expect(changed).toHaveBeenLastCalledWith({ audienceIncludeDescendants: false });
  fireEvent.change(input, { target: { value: '市场' } });
  await choose('市场部');
  expect(changed).toHaveBeenLastCalledWith({ audienceScopeMode: 'ORGS', audienceOrgIds: ['10', '20'] });
  fireEvent.click(screen.getByRole('button', { name: 'employeePublication.audience.all' }));
  expect(changed).toHaveBeenLastCalledWith({ audienceScopeMode: 'COMPANY', audienceOrgIds: [] });
  expect(screen.getByRole('button', { name: 'employeePublication.audience.all' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: 'common.all' }));
  expect(changed).toHaveBeenLastCalledWith({ audienceScopeMode: 'ALL', audienceOrgIds: [] });
});

it('returns to all when the organization selection is cleared', async () => {
  const { container } = render(<Harness />);
  const input = screen.getByRole('combobox');
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.mouseDown(input);
  await choose('研发中心');
  fireEvent.mouseDown(container.querySelector('.ant-select-clear')!);
  expect(changed).toHaveBeenLastCalledWith({ audienceScopeMode: 'ALL', audienceOrgIds: [] });
});

it('allows retry after organization loading fails without changing the current filter', async () => {
  jest.mocked(getPublicationScopeOptions).mockRejectedValueOnce(new Error('offline'));
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: 'digitalEmployees.audienceFilter.retry' }));
  await waitFor(() => expect(getPublicationScopeOptions).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled());
  expect(changed).not.toHaveBeenCalled();
});
