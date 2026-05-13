jest.mock('@/service/chatBI', () => ({
  getChatSystemConfig: jest.fn(),
  queryAllIndicator: jest.fn(),
  queryKnowledgeBaseByUser: jest.fn(),
  queryKnowledgeBaseView: jest.fn(),
  queryKnowledgeBaseViewMeta: jest.fn(),
  querySearchSuggestions: jest.fn(),
}));

import chatBIModel from '../useChatBIStore';

describe('models/useChatBIStore', () => {
  const reducers = (chatBIModel as any).reducers;

  it('save merges payload', () => {
    const state = { analysisSummary: '', indicatorValues: {} };
    expect(reducers.save(state as any, { payload: { analysisLoading: true } })).toEqual({
      analysisSummary: '',
      indicatorValues: {},
      analysisLoading: true,
    });
  });

  it('updateLastAllIndicator updates focus for matching knowledgeId', () => {
    const state = {
      lastAllIndicator: [
        { knowledgeId: '1', focus: 0 },
        { knowledgeId: '2', focus: 0 },
      ],
    };

    const next = reducers.updateLastAllIndicator(state as any, { payload: { knowledgeId: '2', focus: 1 } });
    expect(next.lastAllIndicator).toEqual([
      { knowledgeId: '1', focus: 0 },
      { knowledgeId: '2', focus: 1 },
    ]);
  });

  it('unFollowUpdate removes focus indicator and indicator value', () => {
    const state = {
      focusIndicator: [{ knowledgeId: '1' }, { knowledgeId: '2' }],
      indicatorValues: { '1': { value: 1 }, '2': { value: 2 } },
    };

    const next = reducers.unFollowUpdate(state as any, { payload: { knowledgeId: '1' } });
    expect(next.focusIndicator).toEqual([{ knowledgeId: '2' }]);
    expect(next.indicatorValues).toEqual({ '2': { value: 2 } });
  });

  it('setIndicatorValues merges indicator value maps', () => {
    const state = {
      indicatorValues: { a: 1 },
    };

    expect(reducers.setIndicatorValues(state as any, { payload: { indicatorValues: { b: 2 } } })).toEqual({
      indicatorValues: { a: 1, b: 2 },
    });
  });

  it('setAnalysisSummary appends or clears summary according to isClear', () => {
    const state = { analysisSummary: 'foo' };
    expect(reducers.setAnalysisSummary(state as any, { payload: { analysisSummary: 'bar', isClear: false } })).toEqual({
      analysisSummary: 'foobar',
      isClear: false,
    });
    expect(reducers.setAnalysisSummary(state as any, { payload: { analysisSummary: 'bar', isClear: true } })).toEqual({
      analysisSummary: '',
      isClear: true,
    });
  });

  it('updateFileListBySessionId and clearTempFileList manage session file caches', () => {
    const state = {
      tempFileList: [{ id: 'temp' }],
      fileListBySessionId: {},
    };

    const next = reducers.updateFileListBySessionId(state as any, {
      payload: { sessionId: 's1', fileList: [{ id: 'file-1' }] },
    });
    expect(next.fileListBySessionId).toEqual({ s1: [{ id: 'file-1' }] });
    expect(next.tempFileList).toEqual([]);

    const cached = reducers.clearTempFileList(
      { ...state, tempFileList: [{ id: 'temp-1' }], fileListBySessionId: {} } as any,
      { payload: { sessionId: 's2' } }
    );
    expect(cached.fileListBySessionId).toEqual({ s2: [{ id: 'temp-1' }] });
  });
});
