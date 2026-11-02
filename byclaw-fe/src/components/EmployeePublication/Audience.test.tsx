import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { useState } from 'react';
import PublicationAudience from './Audience';
import { getPublicationScopeOptions } from '@/service/employeePublication';

jest.mock('@umijs/max', () => ({ useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl('zh-CN') }));
jest.mock('@/service/employeePublication', () => ({ getPublicationScopeOptions: jest.fn() }));

const targets = [
  { orgId: '10', orgName: 'Sales', status: 'PENDING' as const, canReview: true },
  { orgId: '20', orgName: 'Delivery', status: 'PENDING' as const, canReview: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPublicationScopeOptions).mockResolvedValue([
    { orgId: '10', parentOrgId: '-1', orgName: 'Sales' },
    { orgId: '20', parentOrgId: '-1', orgName: 'Delivery' },
  ]);
});

it('allows the author to choose an organization instead of the whole company', async () => {
  const changed = jest.fn();
  function Harness() {
    const [value, setValue] = useState(['-1']);
    return (
      <PublicationAudience
        targets={[]}
        editable
        update={false}
        value={value}
        onChange={(ids) => {
          changed(ids);
          setValue(ids);
        }}
        busy={false}
        canReview={false}
        onReview={jest.fn()}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>
  );
  await waitFor(() => expect(getPublicationScopeOptions).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('radio', { name: '指定组织' }));
  expect(changed).toHaveBeenLastCalledWith([]);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByText('Sales'));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(['10']));
  fireEvent.click(screen.getByRole('radio', { name: '全公司' }));
  expect(changed).toHaveBeenLastCalledWith(['-1']);
});

it('only offers review actions for targets returned as reviewable by the server', () => {
  const review = jest.fn();
  render(
    <PublicationAudience
      targets={targets}
      editable={false}
      update={false}
      value={['10', '20']}
      onChange={jest.fn()}
      busy={false}
      canReview
      onReview={review}
    />
  );
  expect(screen.getAllByRole('button', { name: '通过本组织' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '通过本组织' }));
  expect(review).toHaveBeenCalledWith('10', true);
  fireEvent.click(screen.getByRole('button', { name: /驳\s*回/ }));
  expect(review).toHaveBeenLastCalledWith('10', false);
});

it('keeps the shared update audience fixed and explains that the old version remains available', () => {
  render(
    <PublicationAudience
      targets={targets}
      editable
      update
      value={['10', '20']}
      onChange={jest.fn()}
      busy={false}
      canReview={false}
      onReview={jest.fn()}
    />
  );
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByText(/共享配置更新需全部已发布组织审核通过/)).toBeInTheDocument();
  expect(getPublicationScopeOptions).not.toHaveBeenCalled();
});
