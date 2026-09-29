import { message } from 'antd';
import { runWithResourceFeedback } from '../resourceActionFeedback';

jest.mock('antd', () => ({
  message: {
    loading: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    destroy: jest.fn(),
  },
}));

beforeEach(() => jest.clearAllMocks());

it.each(['success', 'error', 'warning'] as const)(
  'replaces processing with %s while row refresh is still pending',
  async (result) => {
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const operation = runWithResourceFeedback(async (feedback) => {
      feedback[result]('Result');
      await refresh;
    }, 'Processing', 'Failed');
    const key = (message.loading as jest.Mock).mock.calls[0][0].key;
    expect(message[result]).toHaveBeenCalledWith({ key, content: 'Result' });
    expect(message.destroy).not.toHaveBeenCalled();
    finishRefresh();
    await operation;
    // finally 不关闭已经显示的成功/失败提示，也不再显示 loading。
    expect(message.destroy).not.toHaveBeenCalled();
    expect(message.loading).toHaveBeenCalledTimes(1);
  }
);

it('replaces loading on a thrown error and preserves the error toast', async () => {
  await runWithResourceFeedback(async () => { throw new Error('Denied'); }, 'Processing', 'Failed');
  const key = (message.loading as jest.Mock).mock.calls[0][0].key;
  expect(message.error).toHaveBeenCalledWith({ key, content: 'Denied' });
  expect(message.destroy).not.toHaveBeenCalled();
});

it('only clears its own loading on early return', async () => {
  await runWithResourceFeedback(() => undefined, 'Processing', 'Failed');
  const key = (message.loading as jest.Mock).mock.calls[0][0].key;
  expect(message.destroy).toHaveBeenCalledWith(key);
  expect(message.success).not.toHaveBeenCalled();
});

it('keeps concurrent operations independent', async () => {
  let finish!: () => void;
  const pending = runWithResourceFeedback(() => new Promise<void>((resolve) => { finish = resolve; }), 'Processing', 'Failed');
  await runWithResourceFeedback((feedback) => feedback.success('Done'), 'Processing', 'Failed');
  const [first, second] = (message.loading as jest.Mock).mock.calls.map(([config]) => config.key);
  expect(first).not.toBe(second);
  expect(message.success).toHaveBeenCalledWith({ key: second, content: 'Done' });
  finish();
  await pending;
  expect(message.destroy).toHaveBeenCalledWith(first);
  expect(message.destroy).not.toHaveBeenCalledWith(second);
});
