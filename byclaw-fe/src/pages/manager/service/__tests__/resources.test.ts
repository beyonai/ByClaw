import {
  applyResourceUse,
  approveUseApply,
  listResourceUseAuth,
  queryUseApplyList,
  queryDigEmployeeRelResourceAuth,
  queryFixedEntryOperationCapability,
  queryResourceDetail,
  queryResourceMembers,
  deleteResource,
} from '../resources';
import { GET, POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('manager resources service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call queryFixedEntryOperationCapability with the capability endpoint', () => {
    queryFixedEntryOperationCapability();
    expect(mockGET).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/queryFixedEntryOperationCapability');
  });

  it('should call listResourceUseAuth with the original endpoint', () => {
    const payload = { resourceBizTypeList: ['VIEW'], keyword: '分析' };
    listResourceUseAuth(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/listResourceUseAuth', payload);
  });

  it('should call queryDigEmployeeRelResourceAuth with the new endpoint', () => {
    const payload = { resourceId: '10042909', keyword: '技能', pageNum: 1, pageSize: 10 };
    queryDigEmployeeRelResourceAuth(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/queryDigEmployeeRelResourceAuth', payload);
  });

  it('should call queryResourceMembers with the details endpoint', () => {
    const payload = { resourceId: '10042909' };
    queryResourceMembers(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/queryResourceMembers', payload);
  });

  it('should call queryResourceDetail with the tool detail endpoint', () => {
    const payload = { resourceId: '10042909' };
    queryResourceDetail(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/tool/queryResourceDetail', payload);
  });

  it('should call deleteResource with the tool delete endpoint', () => {
    const payload = { resourceId: '10042909' };
    deleteResource(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/tool/deleteResourceById', payload);
  });

  it('should call applyResourceUse with the apply use endpoint', () => {
    const payload = { resourceId: '10042909' };
    applyResourceUse(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/applyUse', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('should call queryUseApplyList with the audit list endpoint', () => {
    const payload = { resourceId: '10042909' };
    queryUseApplyList(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/queryUseApplyList', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('should call approveUseApply with the approve endpoint', () => {
    const payload = { resourceId: '10042909', applyUserId: '1' };
    approveUseApply(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/approveUseApply', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });
});
