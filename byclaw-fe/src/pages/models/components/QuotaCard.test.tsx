import { act, render, screen, waitFor } from '@testing-library/react';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import messages from '../locales/zh-CN';
import QuotaCard from './QuotaCard';

const mockIntl = { formatMessage: ({ id }: { id: string }) => messages[id] || id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));

const quota = {
  used: 1200,
  quotaLimit: 300000000,
  quotaUsed: 300000000,
  exceeded: true,
  resetDate: '2026-11-01',
  modelUsages: [{ modelCode: 'example-model', displayName: 'Example Model', tokensUsed: 1200 }],
};

beforeEach(() => jest.mocked(getDcSystemConfig).mockReset());

it('hides the quota overview while loading and for commercial deployments, keeping usage statistics', async () => {
  let resolveConfig!: (value: any) => void;
  jest.mocked(getDcSystemConfig).mockReturnValue(
    new Promise((resolve) => {
      resolveConfig = resolve;
    })
  );
  render(<QuotaCard quota={quota} />);
  expect(screen.queryByText('用量概览')).not.toBeInTheDocument();
  await act(async () => resolveConfig({ paramValue: 'commercial' }));
  expect(getDcSystemConfig).toHaveBeenCalledWith({ paramCode: 'BYAI_BRAND_VERSION' });
  expect(screen.queryByText('用量概览')).not.toBeInTheDocument();
  expect(screen.queryByText('本月已用')).not.toBeInTheDocument();
  expect(screen.queryByText('本月额度已用完')).not.toBeInTheDocument();
  expect(screen.queryByText(messages['personalModel.quota.desc'])).not.toBeInTheDocument();
  expect(screen.getByText('Total Tokens')).toBeInTheDocument();
  expect(screen.getByText('Example Model')).toBeInTheDocument();
});

it.each(['openSource', undefined])('retains the quota overview for noncommercial edition %s', async (edition) => {
  jest.mocked(getDcSystemConfig).mockResolvedValue({ paramValue: edition });
  render(<QuotaCard quota={quota} />);
  await waitFor(() => expect(screen.getByText('用量概览')).toBeInTheDocument());
  expect(screen.getByText('本月已用')).toBeInTheDocument();
  expect(screen.getByText('300.00M / 300.00M')).toBeInTheDocument();
  expect(screen.getByText(messages['personalModel.quota.desc'])).toBeInTheDocument();
  expect(screen.getByText('Total Tokens')).toBeInTheDocument();
});

it('keeps the quota overview hidden if the deployment configuration cannot be read', async () => {
  let rejectConfig!: (reason: Error) => void;
  jest.mocked(getDcSystemConfig).mockReturnValue(
    new Promise((_, reject) => {
      rejectConfig = reject;
    })
  );
  render(<QuotaCard quota={quota} />);
  await act(async () => rejectConfig(new Error('unavailable')));
  expect(screen.queryByText('用量概览')).not.toBeInTheDocument();
  expect(screen.queryByText('本月已用')).not.toBeInTheDocument();
  expect(screen.getByText('Total Tokens')).toBeInTheDocument();
});
