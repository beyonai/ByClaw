import { render, screen } from '@testing-library/react';
import WorkspaceSessionTitle from '../WorkspaceSessionTitle';

it('renders an accessible voice icon for the placeholder and retains real conversation titles', () => {
  const { rerender } = render(<WorkspaceSessionTitle title="[语音消息]" fallback="新建会话" voiceLabel="语音消息" />);
  expect(screen.getByRole('img', { name: '语音消息' })).toBeTruthy();
  expect(screen.queryByText('[语音消息]')).toBeNull();
  rerender(<WorkspaceSessionTitle title="鲸鱼图标设计" fallback="新建会话" voiceLabel="语音消息" />);
  expect(screen.getByText('鲸鱼图标设计')).toBeTruthy();
  expect(screen.queryByRole('img', { name: '语音消息' })).toBeNull();
});
