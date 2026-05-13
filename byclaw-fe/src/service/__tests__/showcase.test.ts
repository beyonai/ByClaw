import { deleteShowcase, getShowcaseList, renameShowcase, saveShowcaseToDoc } from '../showcase';

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Showcase Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getShowcaseList requests custom-handled list data', () => {
    getShowcaseList({ pageNum: 1 });

    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/showcase/list',
      { pageNum: 1 },
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('deleteShowcase calls the delete endpoint', () => {
    deleteShowcase({ id: 1 });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/showcase/delete', { id: 1 });
  });

  it('saveShowcaseToDoc calls the saveToDoc endpoint', () => {
    saveShowcaseToDoc({ id: 1 });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/showcase/saveToDoc', { id: 1 });
  });

  it('renameShowcase sends id and name payload', () => {
    renameShowcase({ id: 1, name: 'New Name' });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/showcase/rename', {
      id: 1,
      name: 'New Name',
    });
  });
});
