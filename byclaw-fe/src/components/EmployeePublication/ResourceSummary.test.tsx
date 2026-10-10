jest.mock('@umijs/max', () => ({ useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl('zh-CN') }));
import type { PublicationDependency } from '@/service/employeePublication';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PublicationResourceSummary from './ResourceSummary';

const dependencies: PublicationDependency[] = [
  { resourceId: '1', name: '企业知识', resourceType: 'KG_DOC', action: 'REFERENCE_RESOURCE' },
  { resourceId: '2', name: '个人知识', resourceType: 'KG_QA', action: 'OMIT_RESOURCE', warning: '个人资源不带入' },
  { resourceId: '3', name: '分析技能', resourceType: 'SKILL', action: 'COPY_SKILL' },
  { resourceId: '*', name: '全部工具', resourceType: 'TOOL', action: 'BUILTIN_TOOL' },
  { resourceId: '4', name: '企业工具', resourceType: 'MCP', action: 'REFERENCE_TOOL', warning: '仅授权成员可用' },
];

it('keeps the two outcome counts and warnings visible while initially collapsing resource details', () => {
  render(<PublicationResourceSummary dependencies={dependencies} onDownloadSkill={jest.fn()} />);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: '不会发布到新数字员工的（1）' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '将发布到新数字员工的（4）' })).toBeInTheDocument();
  expect(screen.getByText('1 项不会带入')).toBeInTheDocument();
  expect(screen.getByText('1 项使用范围受限')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /展开说明/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('个人知识')).not.toBeInTheDocument();
});

it('separates omitted and retained resources, prioritizes restrictions and preserves skill download', () => {
  const onDownloadSkill = jest.fn();
  render(<PublicationResourceSummary dependencies={dependencies} onDownloadSkill={onDownloadSkill} />);
  fireEvent.click(screen.getByRole('button', { name: /展开说明/ }));
  const omittedPanel = within(screen.getByRole('tabpanel'));
  expect(omittedPanel.getAllByRole('listitem')).toHaveLength(1);
  expect(omittedPanel.getByText('个人知识')).toBeInTheDocument();
  expect(omittedPanel.queryByText('企业知识')).not.toBeInTheDocument();
  expect(screen.queryByText('全部工具')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '将发布到新数字员工的（4）' }));
  expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')[0]).toHaveTextContent('企业工具');
  expect(screen.getByText('分析技能')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '下载待审技能' }));
  expect(onDownloadSkill).toHaveBeenCalledWith(dependencies[2]);
  fireEvent.click(screen.getByRole('button', { name: /收起说明/ }));
  expect(screen.queryByText('分析技能')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '将发布到新数字员工的（4）' }));
  expect(screen.getByText('全部工具')).toBeInTheDocument();
  expect(screen.getByText('仅授权成员可用')).toBeInTheDocument();
});

it('keeps legacy omitted resources in the omission tab and explains an empty retained tab', () => {
  render(
    <PublicationResourceSummary
      dependencies={[{ resourceId: 'old', name: '历史资源', action: 'OMIT_RESOURCE', warning: '资源已失效' }]}
      onDownloadSkill={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: '不会发布到新数字员工的（1）' }));
  expect(screen.getByText('历史资源')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '将发布到新数字员工的（0）' }));
  expect(screen.getByText('暂无可发布到新数字员工的资源')).toBeInTheDocument();
});
