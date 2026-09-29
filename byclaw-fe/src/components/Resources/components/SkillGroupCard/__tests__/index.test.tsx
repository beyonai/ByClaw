jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('antd', () => ({
  Dropdown: ({ children, menu }: any) => (
    <div>
      {children}
      {menu?.items?.map((item: any) => (
        <button key={item.key} type="button" onClick={() => item.onClick({ domEvent: { stopPropagation: jest.fn() } })}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SkillGroupCard from '..';
import type { SkillGroup } from '@/pages/manager/service/resources';

const group: SkillGroup = {
  resourceId: 'group-1',
  resourceName: 'Group One',
  resourceDesc: 'A useful group',
  avatar: '',
  catalogId: 'catalog-1',
  ownerType: 'enterprise',
  resourceStatus: 3,
  createBy: 'adminvip',
  createTime: '',
  updateTime: '',
  memberCount: 1,
  members: [],
};

describe('SkillGroupCard deletion action', () => {
  it('shows the delete action only when deletion is allowed', () => {
    const onDelete = jest.fn();

    const { rerender } = render(<SkillGroupCard group={group} canDelete={false} onDelete={onDelete} />);
    expect(screen.queryByRole('button', { name: 'resource.skillGroup.delete' })).not.toBeInTheDocument();

    rerender(<SkillGroupCard group={group} canDelete onDelete={onDelete} />);
    const deleteButton = screen.getByRole('button', { name: 'resource.lifecycle.deleteData' });
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith(group);
  });
});

// 已上架只能下架，注销后不再开放详情和恢复入口。
it('exposes unpublish before deregistration and locks terminal groups', () => {
  const onUnShelf = jest.fn();
  const onClick = jest.fn();
  const { rerender } = render(
    <SkillGroupCard group={{ ...group, resourceStatus: 2 }} canDelete onUnShelf={onUnShelf} onDelete={jest.fn()} />
  );
  expect(screen.queryByText('resource.lifecycle.deleteData')).toBeNull();
  fireEvent.click(screen.getByText('resource.lifecycle.unShelfData'));
  expect(onUnShelf).toHaveBeenCalledTimes(1);
  rerender(
    <SkillGroupCard
      group={{ ...group, resourceStatus: -1 }}
      canDelete
      onClick={onClick}
      onShelf={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
    />
  );
  expect(screen.getByText('resource.statusCancelled')).toBeTruthy();
  expect(screen.queryByText('resource.lifecycle.shelfData')).toBeNull();
  fireEvent.click(screen.getByText(group.resourceName));
  expect(onClick).not.toHaveBeenCalled();
});
