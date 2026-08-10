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
  uploadSkillZip,
  pageSkillGroups,
  pageSkillGroupMemberCandidates,
  getSkillGroupDetail,
  installSkillGroup,
  createSkillGroup,
  addSkillGroupMembers,
  updateSkillGroup,
  removeSkillGroupMembers,
} from '../resources';
import type { SkillGroup, SkillGroupInstallResult, SkillGroupPageResult } from '../resources';
import { GET, POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

const skillGroupResponseFixture: SkillGroup = {
  resourceId: '10042909',
  resourceName: '数据分析技能组',
  resourceDesc: '常用数据分析技能',
  avatar: 'https://example.com/skill-group.png',
  catalogId: '1001',
  ownerType: 'enterprise',
  resourceStatus: 2,
  createBy: '10001',
  createTime: '2026-08-04 10:00:00',
  updateTime: '2026-08-04 10:30:00',
  memberCount: 1,
  members: [
    {
      resourceId: '10042911',
      resourceCode: 'data-query',
      resourceName: '数据查询',
      resourceDesc: '查询数据',
      avatar: 'https://example.com/skill.png',
      resourceStatus: 2,
      ownerType: 'enterprise',
      createBy: '10001',
      skillType: 'builtin',
      sourceType: 'catalog',
      version: '1.0.0',
      skillUrl: 'https://example.com/skill',
      skillPackageFormat: 'zip',
      skillOriginalFilename: 'data-query.zip',
      skillPackageSize: 1024,
      skillPackageHash: 'sha256:abc',
      targetContent: 'query',
      syncStatus: 'synced',
      syncError: '',
      lastSyncTime: '2026-08-04 10:20:00',
    },
  ],
};

const pageSkillGroupsResponseFixture: SkillGroupPageResult = {
  pageNum: 1,
  pageSize: 10,
  total: 1,
  totalPages: 1,
  list: [skillGroupResponseFixture],
};

const installSkillGroupResponseFixture: SkillGroupInstallResult = {
  installedSkillIds: ['10042911'],
  existingSkillIds: [],
  removedSkillIds: [],
  retainedSkillIds: [],
  totalSkillIds: ['10042911'],
};

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

  it('should call uploadSkillZip with multipart config', () => {
    const payload = new FormData();
    uploadSkillZip(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/tool/uploadSkillZip', payload, {
      timeout: 480000,
      headers: {
        'Content-Type': 'multipart/form-data; charset=utf-8',
      },
    });
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

  it('should call pageSkillGroups with the skill group page endpoint', () => {
    const payload = {
      pageNum: 1,
      pageSize: 10,
      keyword: '技能组',
      ownerType: 'enterprise',
      resourceStatus: 2,
      catalogId: '1001',
    };
    pageSkillGroups(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/page', payload);
  });

  it('should call getSkillGroupDetail with the skill group detail endpoint', () => {
    const payload = { groupId: '10042909' };
    getSkillGroupDetail(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/detail', payload);
  });

  it('should call pageSkillGroupMemberCandidates with the dedicated candidate endpoint', () => {
    const payload = { groupId: '10042909', pageNum: 1, pageSize: 100, keyword: '' };
    pageSkillGroupMemberCandidates(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/member/candidates', payload);
  });

  it('should call installSkillGroup with the skill group install endpoint', () => {
    const payload = { groupId: '10042909', digitalEmployeeId: '10042910' };
    installSkillGroup(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/install', payload);
  });

  it('should call createSkillGroup with the skill group create endpoint', () => {
    const payload = {
      resourceName: '知识协同',
      resourceDesc: '连接知识与协作渠道',
      avatar: '/uploads/knowledge-collaboration.png',
      ownerType: 'enterprise',
    };
    createSkillGroup(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/create', payload);
  });

  it('should call addSkillGroupMembers with the member association endpoint', () => {
    const payload = { groupId: '10042909', skillIds: ['10042911', '10042912'] };
    addSkillGroupMembers(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/member/add', payload);
  });

  it('should call updateSkillGroup with the skill group update endpoint', () => {
    const payload = {
      groupId: '10042909',
      resourceName: '智采协同',
      resourceDesc: '整合采集与协作能力',
      avatar: '/commonFile/preview?filePath=/covers/group.png',
    };
    updateSkillGroup(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/update', payload);
  });

  it('should call removeSkillGroupMembers with the member removal endpoint', () => {
    const payload = { groupId: '10042909', skillIds: ['10042911'] };
    removeSkillGroupMembers(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/skillGroup/member/remove', payload);
  });

  it('should type skill group responses with string IDs', () => {
    expect(pageSkillGroupsResponseFixture.list[0].resourceId).toBe('10042909');
    expect(pageSkillGroupsResponseFixture.list[0].members[0].resourceId).toBe('10042911');
    expect(installSkillGroupResponseFixture.totalSkillIds).toEqual(['10042911']);
  });
});
