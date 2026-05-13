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

  it('registerAppModalError stores modal handler and showRequestErrorModal uses it', () => {
    const modalError = jest.fn();
    registerAppModalError(modalError);

    showRequestErrorModal('boom');

    expect(modalError).toHaveBeenCalledWith({ content: 'boom' });
    expect((message as any).error).not.toHaveBeenCalled();
  });

  it('falls back to message.error and normalizes blank content', () => {
    showRequestErrorModal('');
    expect((message as any).error).toHaveBeenCalledWith('请求失败');
  });
});
