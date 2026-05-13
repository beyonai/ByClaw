jest.mock('@/utils/math', () => ({
  getRandomNumber: jest.fn(() => 1),
}));

import {
  addSessionHandler,
  formatByUpdateTime,
  getSessionObjectTypeMap,
  sessionHandler,
  setSessionObjectTypeMap,
  updateSessionHandler,
} from '../session';

describe('utils/session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('formatByUpdateTime sorts sessions by updateTime descending', () => {
    expect(
      formatByUpdateTime([
        { sessionId: '1', updateTime: '1' } as any,
        { sessionId: '2', updateTime: '3' } as any,
        { sessionId: '3', updateTime: '2' } as any,
      ]).map((item) => item.sessionId)
    ).toEqual(['2', '3', '1']);
  });

  it('updateSessionHandler updates an existing session and re-sorts the list', () => {
    const state = {
      sessionList: [
        { sessionId: '1', updateTime: '1', sessionName: 'old' },
        { sessionId: '2', updateTime: '2', sessionName: 'keep' },
      ],
    } as any;

    const next = updateSessionHandler(state, {
      sessionId: '1',
      updateTime: '3',
      sessionName: 'new',
    } as any);

    expect(next.sessionList.map((item: any) => `${item.sessionId}:${item.sessionName}`)).toEqual(['1:new', '2:keep']);
  });

  it('setSessionObjectTypeMap and getSessionObjectTypeMap store normalized values', () => {
    setSessionObjectTypeMap('session-1', 100, 'Agent');
    expect(getSessionObjectTypeMap('session-1')).toEqual({
      objectId: '100',
      objectType: 'Agent',
    });
  });

  it('sessionHandler adds default avatar, theme and session object mapping', () => {
    const payload = sessionHandler({
      sessionId: 1,
      objectId: 10,
      objectType: 'Agent',
      sessionName: 'Test',
    } as any);

    expect(payload).toMatchObject({
      sessionId: '1',
      avatar: 'beyond/session.png',
      theme: 'cyan',
      sessionName: 'Test',
    });
    expect(getSessionObjectTypeMap(1 as any)).toEqual({
      objectId: '10',
      objectType: 'Agent',
    });
  });

  it('sessionHandler overrides avatar for notification sessions', () => {
    const payload = sessionHandler({
      sessionId: 2,
      objectType: 'Notification',
      sessionName: 'Notice',
    } as any);

    expect(payload.avatar).toBe('beyond/noticeHead.png');
  });

  it('sessionHandler mutates existing target session without overriding theme', () => {
    const target = { sessionId: '1', theme: 'existing', sessionName: 'old' } as any;
    const result = sessionHandler(
      { sessionId: '1', sessionName: 'new', avatar: '', objectType: 'Agent', objectId: '10' } as any,
      [target]
    );

    expect(result).toBe(target);
    expect(target.theme).toBe('existing');
    expect(target.sessionName).toBe('new');
  });

  it('addSessionHandler prepends a new session and uses default sessionName', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const next = addSessionHandler(
      {
        sessionList: [{ sessionId: 'old', sessionName: 'Old', updateTime: '1' }],
      } as any,
      {
        sessionId: 'new',
        objectType: 'Agent',
        objectId: '1',
      } as any
    );

    expect(next.sessionList[0]).toMatchObject({
      sessionId: 'new',
      sessionName: 'New Chat',
      updateTime: '1000',
    });
  });
});
