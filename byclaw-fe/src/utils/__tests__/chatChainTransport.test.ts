const mockPost = jest.fn();
const mockCreate = jest.fn(() => ({ post: mockPost }));
jest.mock('axios', () => ({ __esModule: true, default: { create: (...args: any[]) => mockCreate(...args) } }));
jest.mock('../auth', () => ({
  getToken: () => 'test-token',
  getssoToken: () => '',
  getSessionKey: () => 'test-session',
  tokenKey: 'beyond-token',
  ssotokenKey: 'sso-token',
}));
jest.mock('../signature', () => ({ generateSignature: () => ({ 'x-signature-value': 'test-signature' }) }));
const { sendChatChainBatch } = require('../chatChainTransport');

describe('isolated diagnostic transport', () => {
  it('requires an explicit business acknowledgement before clearing stored events', async () => {
    const events = [{ requestId: 'root', stage: 'fe.sent' }];
    mockPost.mockResolvedValueOnce({ data: { code: -1 } });
    await expect(sendChatChainBatch(events)).rejects.toThrow('not acknowledged');
    mockPost.mockResolvedValueOnce({ data: { code: 0 } });
    await expect(sendChatChainBatch(events)).resolves.toBeUndefined();
    expect(mockPost.mock.calls[1][1]).toEqual({ events });
  });
  it('uses its own bounded-time client without shared authentication/error interceptors', async () => {
    expect(mockCreate).toHaveBeenCalledWith({ timeout: 5000 });
    mockPost.mockRejectedValueOnce(new Error('401'));
    await expect(sendChatChainBatch([])).rejects.toThrow('401');
  });
});
