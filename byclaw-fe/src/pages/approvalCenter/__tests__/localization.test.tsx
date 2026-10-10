import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ApprovalCenter from '..';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => {
  const { useState } = require('react');
  return {
    useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
    useSearchParams: () => {
      const [query, setQuery] = useState('');
      return [new URLSearchParams(query), (next: URLSearchParams) => setQuery(String(next))];
    },
  };
});
jest.mock('@/hooks/useApprovalPendingCounts', () => ({
  __esModule: true,
  default: () => ({ counts: {}, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useEmployeePublicationCapabilities', () => ({
  __esModule: true,
  default: () => ({ enabled: true, administrator: true }),
}));
jest.mock('@/components/Resources/components/ResourceAuditCenter', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/EmployeePublication/AuditList', () => ({ __esModule: true, default: () => null }));
afterEach(cleanup);

it.each([
  ['zh-CN', ['员工申请', '技能申请', '知识申请', '工具申请'], '使用授权审核', '员工发布审核'],
  [
    'en-US',
    ['Employee applications', 'Skill applications', 'Knowledge applications', 'Tool applications'],
    'Use authorization review',
    'Employee publication review',
  ],
] as const)('renders all approval tabs and employee selectors in %s', (locale, tabs, use, publication) => {
  mockLocale = locale;
  render(<ApprovalCenter />);
  for (const label of tabs) expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
  expect(screen.getByText(use)).toBeInTheDocument();
  fireEvent.click(screen.getByText(publication));
  expect(screen.getByText(publication)).toBeInTheDocument();
  expect(screen.queryByText(/approvalCenter\./)).not.toBeInTheDocument();
});

it('refreshes labels when the language changes without remounting the approval page', () => {
  mockLocale = 'zh-CN';
  const { rerender } = render(<ApprovalCenter />);
  expect(screen.getByText('员工发布审核')).toBeInTheDocument();
  mockLocale = 'en-US';
  rerender(<ApprovalCenter />);
  expect(screen.getByText('Employee publication review')).toBeInTheDocument();
  expect(screen.queryByText('员工发布审核')).not.toBeInTheDocument();
});
