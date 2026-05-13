jest.mock('@/service/knowledgeCenter', () => ({
  catalogTree: jest.fn(),
  getPriviledgeList: jest.fn(),
  getResourceListByPage: jest.fn(),
  queryAuthDoc: jest.fn(),
  queryDirAndFileByLevel: jest.fn(),
  queryResourceDetail: jest.fn(),
}));

jest.mock('zustand/middleware', () => ({
  devtools: (fn: any) => fn,
  persist: (fn: any) => fn,
}));

import {
  catalogTree,
  getPriviledgeList,
  getResourceListByPage,
  queryAuthDoc,
  queryDirAndFileByLevel,
  queryResourceDetail,
} from '@/service/knowledgeCenter';
import useKnowledgeStore from '../useKnowledgeStore';

const mockCatalogTree = catalogTree as jest.MockedFunction<typeof catalogTree>;
const mockGetPriviledgeList = getPriviledgeList as jest.MockedFunction<typeof getPriviledgeList>;
const mockGetResourceListByPage = getResourceListByPage as jest.MockedFunction<typeof getResourceListByPage>;
const mockQueryAuthDoc = queryAuthDoc as jest.MockedFunction<typeof queryAuthDoc>;
const mockQueryDirAndFileByLevel = queryDirAndFileByLevel as jest.MockedFunction<typeof queryDirAndFileByLevel>;
const mockQueryResourceDetail = queryResourceDetail as jest.MockedFunction<typeof queryResourceDetail>;

describe('models/useKnowledgeStore', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      activeTab: 'enterprise',
      resourceLoading: false,
      resourceList: [],
      shareListLoading: false,
      shareList: [],
      directoryLoading: false,
      directoryList: [],
      catalogTree: [],
      priviledgeData: {
        list: [],
        pagination: {
          pageIndex: 1,
          pageSize: 12,
          total: 0,
        },
      },
    });
    jest.clearAllMocks();
  });

  it('setState merges payload', () => {
    useKnowledgeStore.getState().setState({ activeTab: 'personal' });
    expect(useKnowledgeStore.getState().activeTab).toBe('personal');
  });

  it('getResourceListByPage stores rows and returns normalized page info', async () => {
    mockGetResourceListByPage.mockResolvedValue({
      rows: [{ id: 1 }],
      pageNum: 2,
      pageSize: 20,
      total: 30,
      totalPages: 2,
    } as any);

    const result = await useKnowledgeStore.getState().getResourceListByPage({ pageSize: 20 });

    expect(useKnowledgeStore.getState().resourceList).toEqual([{ id: 1 }]);
    expect(result).toEqual({
      pageIndex: 2,
      pageNum: 2,
      pageSize: 20,
      total: 30,
      totalPages: 2,
      totalPage: 2,
      pageCount: 2,
    });
  });

  it('queryResourceDetail returns service result', async () => {
    mockQueryResourceDetail.mockResolvedValue({ id: 1 } as any);
    await expect(useKnowledgeStore.getState().queryResourceDetail({ id: 1 })).resolves.toEqual({ id: 1 });
  });

  it('getBeShared stores share list and returns pagination', async () => {
    mockQueryAuthDoc.mockResolvedValue({
      list: [{ id: 1 }],
      pageNum: 1,
      pageSize: 10,
      total: 20,
      totalPages: 2,
    } as any);

    const result = await useKnowledgeStore.getState().getBeShared({});
    expect(useKnowledgeStore.getState().shareList).toEqual([{ id: 1 }]);
    expect(result).toEqual({
      pageIndex: 1,
      pageNum: 1,
      pageSize: 10,
      total: 20,
      pageCount: 2,
      totalPages: 2,
    });
  });

  it('queryDirAndFileByLevel stores directory list', async () => {
    mockQueryDirAndFileByLevel.mockResolvedValue([{ id: 1 }] as any);
    await useKnowledgeStore.getState().queryDirAndFileByLevel({} as any);
    expect(useKnowledgeStore.getState().directoryList).toEqual([{ id: 1 }]);
  });

  it('getCatalogTree stores result', async () => {
    mockCatalogTree.mockResolvedValue([{ id: 1 }] as any);
    await expect(useKnowledgeStore.getState().getCatalogTree({})).resolves.toEqual([{ id: 1 }]);
    expect(useKnowledgeStore.getState().catalogTree).toEqual([{ id: 1 }]);
  });

  it('getPriviledgeList appends rows after first page', async () => {
    mockGetPriviledgeList.mockResolvedValue({
      rows: [{ id: 2 }],
      pageInfo: { pageIndex: 2, pageSize: 12, total: 20 },
    } as any);
    useKnowledgeStore.setState({
      priviledgeData: {
        list: [{ id: 1 }],
        pagination: { pageIndex: 1, pageSize: 12, total: 20 },
      },
    });

    await useKnowledgeStore.getState().getPriviledgeList({ pageIndex: 2 });
    expect(useKnowledgeStore.getState().priviledgeData.list).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
