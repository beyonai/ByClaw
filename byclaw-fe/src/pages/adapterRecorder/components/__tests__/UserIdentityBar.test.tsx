import { fireEvent, render, screen } from '@testing-library/react';

import type { UserInfo } from '@/models/common/user';
import UserIdentityBar from '../UserIdentityBar';

const fixture = {
  userId: 1,
  userCode: 'ljh',
  userName: '李嘉辉',
  email: 'ljh@example.com',
  phone: '13800000000',
  usersOrganizations: [
    {
      orgId: 1,
      orgName: 'WhaleBI',
      positionId: 1,
      positionName: '研发工程师',
      userType: 'employee',
      pathCode: '1',
      pathName: 'WhaleBI',
    },
  ],
} as UserInfo;

describe('UserIdentityBar', () => {
  it('renders a compact identity and expands account details', () => {
    render(<UserIdentityBar userInfo={fixture} />);

    const trigger = screen.getByRole('button', { name: '当前用户：李嘉辉' });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText('李')).toBeInTheDocument();
    expect(screen.queryByText('ljh')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByText('ljh')).toBeInTheDocument();
    expect(screen.getByText('WhaleBI')).toBeInTheDocument();
    expect(screen.getByText('研发工程师')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('falls back to user code and initials when the display name is missing', () => {
    render(<UserIdentityBar userInfo={{ ...fixture, userName: '', avatar: '' }} />);

    expect(screen.getByRole('button', { name: '当前用户：ljh' })).toBeInTheDocument();
    expect(screen.getByText('l')).toBeInTheDocument();
  });

  it('does not render when there is no authenticated user', () => {
    const { container } = render(<UserIdentityBar userInfo={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
