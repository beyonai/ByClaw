import { act, fireEvent, render, screen } from '@testing-library/react';
import PublicationLoading from './Loading';

it('explains a longer wait and keeps the return action available', () => {
  jest.useFakeTimers();
  const back = jest.fn();
  const { unmount } = render(<PublicationLoading title="正在加载待发布配置" onBack={back} />);
  expect(screen.getByText('正在加载待发布配置')).toBeInTheDocument();
  expect(screen.getByText('请稍候，完成后将自动显示。')).toBeInTheDocument();
  act(() => {
    jest.advanceTimersByTime(8000);
  });
  expect(screen.getByText('加载时间比平时稍长，仍在处理中，请勿重复操作。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回员工列表' }));
  expect(back).toHaveBeenCalledTimes(1);
  unmount();
  jest.useRealTimers();
});
