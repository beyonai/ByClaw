jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { getOrgTree, getSourceSystemList, listResource, queryCatalogTree } from '../OrgMgr';
import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/OrgMgr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queryCatalogTree posts params directly', () => {
    const payload = { catalogType: 1 };
    queryCatalogTree(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/catalog/queryCatalogTree', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('getSourceSystemList posts params directly', () => {
    const payload = { standType: 'MODEL' };
    getSourceSystemList(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/sourcesystem/getSourceSystemListByType', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('getOrgTree posts params directly', () => {
    const payload = { orgId: '1' };
    getOrgTree(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/organization/getOrgTree', payload);
  });

  it('listResource posts params with customHandle config', () => {
    const payload = { pageNum: 1 };
    listResource(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/listResource', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });
});
