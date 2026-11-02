import { POST } from '@/service/common/request';
import { removeCachedModelHealth } from '@/service/modelHealth';
import { deleteMyModel } from '@/pages/models/service';
import { deleteModel } from '@/pages/manager/service/ModelMgr';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/service/modelHealth', () => ({ removeCachedModelHealth: jest.fn() }));
jest.mock('@umijs/max', () => ({ getIntl: jest.fn(), getLocale: jest.fn() }));
jest.mock('@/pages/manager/utils/auth', () => ({}));
jest.mock('@/pages/manager/utils/signature', () => ({}));

beforeEach(() => jest.clearAllMocks());

describe.each([
  ['personal', deleteMyModel],
  ['public', deleteModel],
] as const)('%s model deletion', (_, remove) => {
  it('purges the deleted model only after confirmed server success', async () => {
    (POST as jest.Mock).mockResolvedValue({ code: 0, data: true });
    await expect(remove({ id: '42' })).resolves.toMatchObject({ code: 0, data: true });
    expect(removeCachedModelHealth).toHaveBeenCalledWith('42');
  });

  it.each([
    { code: 500, data: false },
    { code: 0, success: false },
    { code: 0, data: false },
  ])('preserves the warning when deletion fails: %j', async (response) => {
    (POST as jest.Mock).mockResolvedValue(response);
    await remove({ id: '42' });
    expect(removeCachedModelHealth).not.toHaveBeenCalled();
  });

  it('preserves the warning on a network error', async () => {
    (POST as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(remove({ id: '42' })).rejects.toThrow('network');
    expect(removeCachedModelHealth).not.toHaveBeenCalled();
  });
});
