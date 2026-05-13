jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import {
  bathQryPropertyKey,
  clearCache,
  currentUser,
  editEnterprise,
  getAllDistinctParams,
  getDcSystemConfig,
  getDcSystemConfigListByStandType,
  getDcSystemConfigValueByCodes,
  getEnterprise,
  qryPropertyKey,
} from '../session';
import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getDcSystemConfig posts params directly', () => {
    const payload = { standType: 'DEV' };
    getDcSystemConfig(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfig', payload);
  });

  it('getDcSystemConfigValueByCodes posts payload directly', () => {
    const payload = { paramCodes: ['A', 'B'] };
    getDcSystemConfigValueByCodes(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/getDcSystemConfigValueByCodes', payload);
  });

  it('getDcSystemConfigListByStandType adds customHandle config', () => {
    const payload = { standType: 'PROD' };
    getDcSystemConfigListByStandType(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getDcSystemConfigListByStandType', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('bathQryPropertyKey posts params directly', () => {
    const payload = { keys: ['A'] };
    bathQryPropertyKey(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/property/bathQryPropertyKey', payload);
  });

  it('currentUser posts without payload', () => {
    currentUser();
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/session/currentUser');
  });

  it('getEnterprise posts params directly', () => {
    const payload = { enterpriseId: '1' };
    getEnterprise(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/enterprise/getEnterprise', payload);
  });

  it('editEnterprise posts params directly', () => {
    const payload = { enterpriseName: 'Beyond' };
    editEnterprise(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/enterprise/editEnterprise', payload);
  });

  it('qryPropertyKey posts params directly', () => {
    const payload = { key: 'A' };
    qryPropertyKey(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/property/qryPropertyKey', payload);
  });

  it('getAllDistinctParams posts params directly', () => {
    const payload = { type: 'MODEL' };
    getAllDistinctParams(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/getAllDistinctParams', payload);
  });

  it('clearCache posts params directly', () => {
    const payload = { cacheName: 'menu' };
    clearCache(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/staticdata/clearCache', payload);
  });
});
