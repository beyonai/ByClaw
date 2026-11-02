import { changeDraftSessionProject } from '../devloop';
import { POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));

describe('changeDraftSessionProject', () => {
  it('updates the project before the first question is sent', () => {
    changeDraftSessionProject({ sessionId: 101, projectId: 202 });

    expect(POST).toHaveBeenCalledWith(
      '/byaiService/project/session/changeDraftProject',
      {
        sessionId: 101,
        projectId: 202,
      },
      { responseCfg: { hideErrorTips: true } }
    );
  });
});
