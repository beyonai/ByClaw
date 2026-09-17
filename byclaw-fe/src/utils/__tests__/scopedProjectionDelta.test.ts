import { applyScopedProjectionDelta } from '../scopedProjectionDelta';

describe('scopedProjectionDelta', () => {
  it('reconstructs append and JSON array splice operations exactly', () => {
    const base = {
      sessionId: '200',
      messageId: 'answer-1',
      messageContent: '重复',
      inferLog: JSON.stringify([{ id: 1 }]),
      msgStatus: 1,
    };

    const result = applyScopedProjectionDelta(
      { projection: base, streamId: '100-0' },
      {
        streamId: '101-0',
        data: {
          baseStreamId: '100-0',
          streamId: '101-0',
          sessionId: '200',
          messageId: 'answer-1',
          operations: [
            { field: 'messageContent', op: 'append', offset: 2, value: '重复' },
            {
              field: 'inferLog',
              op: 'json-array-splice',
              index: 1,
              deleteCount: 0,
              value: [{ id: 2 }],
            },
            { field: 'msgStatus', op: 'set', value: 0 },
          ],
        },
      }
    );

    expect(result).toEqual({
      streamId: '101-0',
      projection: {
        sessionId: '200',
        messageId: 'answer-1',
        messageContent: '重复重复',
        inferLog: JSON.stringify([{ id: 1 }, { id: 2 }]),
        msgStatus: 0,
      },
    });
  });

  it('rejects a delta when its base or append offset does not match', () => {
    const state = {
      projection: { sessionId: '200', messageId: 'answer-1', messageContent: 'current' },
      streamId: '102-0',
    };

    expect(
      applyScopedProjectionDelta(state, {
        streamId: '103-0',
        data: {
          baseStreamId: '101-0',
          operations: [{ field: 'messageContent', op: 'append', offset: 7, value: 'x' }],
        },
      })
    ).toBeNull();
    expect(
      applyScopedProjectionDelta(state, {
        streamId: '103-0',
        data: {
          baseStreamId: '102-0',
          operations: [{ field: 'messageContent', op: 'append', offset: 6, value: 'x' }],
        },
      })
    ).toBeNull();
  });

  it('applies nested JSON patches without replacing stable object content', () => {
    const inferLog = JSON.stringify([{ id: 1, choices: [{ delta: { content: 'hello' } }], stable: 'x'.repeat(8000) }]);
    const lastEvent = JSON.stringify({ content: 'a', stable: 'x'.repeat(4000) });

    const result = applyScopedProjectionDelta(
      {
        projection: { sessionId: '200', messageId: 'answer-1', inferLog, lastEvent },
        streamId: '100-0',
      },
      {
        streamId: '101-0',
        data: {
          baseStreamId: '100-0',
          streamId: '101-0',
          sessionId: '200',
          messageId: 'answer-1',
          operations: [
            {
              field: 'inferLog',
              op: 'json-patch',
              patches: [
                {
                  op: 'append',
                  path: [0, 'choices', 0, 'delta', 'content'],
                  offset: 5,
                  value: ' world',
                },
              ],
            },
            {
              field: 'lastEvent',
              op: 'json-patch',
              patches: [{ op: 'append', path: ['content'], offset: 1, value: 'b' }],
            },
          ],
        },
      }
    );

    expect(JSON.parse(result!.projection.inferLog)[0].choices[0].delta.content).toBe('hello world');
    expect(JSON.parse(result!.projection.inferLog)[0].stable).toHaveLength(8000);
    expect(JSON.parse(result!.projection.lastEvent).content).toBe('ab');
  });

  it('rejects unsafe or stale nested JSON patches', () => {
    const state = {
      projection: { sessionId: '200', messageId: 'answer-1', inferLog: JSON.stringify([{ content: 'a' }]) },
      streamId: '100-0',
    };
    const envelope = (patch: any) => ({
      data: {
        baseStreamId: '100-0',
        streamId: '101-0',
        operations: [{ field: 'inferLog', op: 'json-patch', patches: [patch] }],
      },
    });

    expect(
      applyScopedProjectionDelta(state, envelope({ op: 'append', path: [0, 'content'], offset: 0, value: 'b' }))
    ).toBeNull();
    expect(
      applyScopedProjectionDelta(state, envelope({ op: 'set', path: ['__proto__', 'polluted'], value: true }))
    ).toBeNull();
  });
});
