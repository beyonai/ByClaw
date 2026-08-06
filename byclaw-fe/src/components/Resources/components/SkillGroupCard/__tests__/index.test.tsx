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
  resourceStatus: 2,
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
    const deleteButtons = screen.getAllByRole('button', { name: 'resource.skillGroup.delete' });
    expect(deleteButtons[0]).toBeInTheDocument();

    fireEvent.click(deleteButtons[1]);
    expect(onDelete).toHaveBeenCalledWith(group);
  });
});
