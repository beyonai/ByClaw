import { fireEvent, render, screen } from '@testing-library/react';
import BindStep from './BindStep';

describe('BindStep', () => {
  const originalRecordingModes = process.env.RECORDER_RECORDING_MODES;

  afterEach(() => {
    if (originalRecordingModes === undefined) {
      delete process.env.RECORDER_RECORDING_MODES;
    } else {
      process.env.RECORDER_RECORDING_MODES = originalRecordingModes;
    }
  });

  it('shows only VNC when no recording-mode environment override is set', () => {
    delete process.env.RECORDER_RECORDING_MODES;
    const onBind = jest.fn();

    render(<BindStep loading={false} onBind={onBind} />);

    expect(screen.queryByText('登录站(投屏)')).not.toBeInTheDocument();
    expect(screen.queryByText('公开站(页内嵌入)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建录制会话' }));

    expect(onBind).toHaveBeenCalledWith('https://juejin.cn/', 'vnc');
  });
});
