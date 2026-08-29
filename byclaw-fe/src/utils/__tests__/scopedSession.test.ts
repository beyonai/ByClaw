import {
  commitScopedStream,
  getExternalSessionExt,
  isExternalChildExtParams,
  isExternalChildSession,
  isScopedChildProjection,
  isScopedStreamNewer,
} from '../scopedSession';

describe('scoped external session helpers', () => {
  it('recognizes only persisted external child sessions', () => {
    expect(
      isExternalChildSession({
        sessionId: '200',
        sessionName: '架构舵手',
        parentSessionId: 100,
        createTime: '',
        updateTime: '',
        sessionExts: [{ extParamCode: 'external_session_id', extParamName: '外部会话标识', extParamValue: 'child-1' }],
      })
    ).toBe(true);
    expect(
      isExternalChildSession({
        sessionId: '201',
        sessionName: '普通子会话',
        parentSessionId: 100,
        createTime: '',
        updateTime: '',
      })
    ).toBe(false);
  });

  it('reads an external session extension value by code', () => {
    expect(
      getExternalSessionExt(
        {
          sessionId: '200',
          sessionName: '架构舵手',
          parentSessionId: 100,
          createTime: '',
          updateTime: '',
          sessionExts: [{ extParamCode: 'external_session_status', extParamName: '状态', extParamValue: 'completed' }],
        },
        'external_session_status'
      )
    ).toBe('completed');
  });

  it('recognizes external child extension maps used by the active chat store', () => {
    expect(isExternalChildExtParams({ external_session_id: 'child-1', external_root_session_id: 'root-1' })).toBe(true);
    expect(isExternalChildExtParams({ beyondTaskId: 'task-1' })).toBe(false);
  });

  it('recognizes a child projection before its session entity reaches the store', () => {
    expect(
      isScopedChildProjection({
        metadata: JSON.stringify({ session_scope: 'child', external_session_id: 'child-1' }),
      })
    ).toBe(true);
    expect(isScopedChildProjection({ metadata: { session_scope: 'parent', external_session_id: 'root-1' } })).toBe(
      false
    );
    expect(isScopedChildProjection({ metadata: '{broken' })).toBe(false);
  });

  it('accepts only strictly newer stream revisions for each child session', () => {
    const watermarks = new Map<string, string>();

    expect(isScopedStreamNewer(watermarks, '200', '100-0')).toBe(true);
    commitScopedStream(watermarks, '200', '100-0');
    expect(isScopedStreamNewer(watermarks, '200', '100-0')).toBe(false);
    expect(isScopedStreamNewer(watermarks, '200', '99-9')).toBe(false);
    expect(isScopedStreamNewer(watermarks, '200', '100-1')).toBe(true);
    expect(isScopedStreamNewer(watermarks, '201', '1-0')).toBe(true);
    expect(isScopedStreamNewer(watermarks, '200', undefined)).toBe(true);
  });
});
