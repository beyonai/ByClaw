import { POST } from '@/service/common/request';
import { releaseSharedMember } from '../SharedSandbox';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@umijs/max', () => ({
  getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl('en-US'),
}));

test('releases the selected mapping generation with explicit manual force and preserves server refusal', async () => {
  (POST as jest.Mock).mockResolvedValueOnce({ code: 0, data: false });
  await expect(
    releaseSharedMember({
      id: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea',
      sandboxRecordId: 's2',
      userCode: 'alice',
      generation: 7,
      status: 'ACTIVE',
    })
  ).resolves.toBe(false);
  expect(POST).toHaveBeenCalledWith(
    '/byaiService/sandbox/shared/releaseMember',
    {
      mappingId: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea',
      generation: 7,
      reason: 'manual',
      force: true,
    },
    { responseCfg: { customHandle: true } }
  );
});

test('surfaces the backend deletion error instead of treating it as a completed release', async () => {
  (POST as jest.Mock).mockResolvedValueOnce({ code: 1, msg: 'Context deletion failed' });
  await expect(
    releaseSharedMember({
      id: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea',
      sandboxRecordId: 's2',
      userCode: 'alice',
      generation: 7,
      status: 'ACTIVE',
    })
  ).rejects.toThrow('Context deletion failed');
});
