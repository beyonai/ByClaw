jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

import { message } from 'antd';
import { registerAppModalError, showRequestErrorModal } from '../antdAppModal';

describe('utils/antdAppModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerAppModalError(null);
  });

  it('showRequestErrorModal uses a non-blocking message even when a modal handler is registered', () => {
    const modalError = jest.fn();
    registerAppModalError(modalError);

    showRequestErrorModal('boom');

    expect(modalError).not.toHaveBeenCalled();
    expect((message as any).error).toHaveBeenCalledWith('boom');
  });

  it('falls back to message.error and normalizes blank content', () => {
    showRequestErrorModal('');
    expect((message as any).error).toHaveBeenCalledWith('请求失败');
  });
});
