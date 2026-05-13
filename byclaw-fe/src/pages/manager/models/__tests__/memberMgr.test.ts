jest.mock('@/pages/manager/service/OrgCenter', () => ({
  getUsersByOrgId: jest.fn(),
  searchPositionList: jest.fn(),
}));

jest.mock('@/pages/manager/service/MemberMgr', () => ({
  addUser: jest.fn(),
  searchUser: jest.fn(),
  updateUser: jest.fn(),
  delUser: jest.fn(),
  getUserExternalSystemList: jest.fn(),
  addUserExternalSystem: jest.fn(),
  removeUserExternalSystem: jest.fn(),
  batchDelUser: jest.fn(),
  resetPassword: jest.fn(),
  addUserByOrg: jest.fn(),
  setDataPermission: jest.fn(),
  getDataPermission: jest.fn(),
}));

import memberMgrModel, { getErrorText } from '../memberMgr';

describe('manager/models/memberMgr', () => {
  const effects = (memberMgrModel as any).effects;
  const sagaHelpers = {
    call: (fn: any, ...args: any[]) => ({ type: 'call', fn, args }),
  };

  describe('getErrorText', () => {
    it('prefers string and object message fields', () => {
      expect(getErrorText('员工工号非必填')).toBe('员工工号非必填');
      expect(getErrorText({ msg: 'from msg' })).toBe('from msg');
      expect(getErrorText({ message: 'from message' })).toBe('from message');
      expect(getErrorText(null)).toBe('请求失败');
    });
  });

  it('addUser routes request exceptions to fail callback', () => {
    const fail = jest.fn();
    const iterator = effects.addUser({ payload: { userName: 'Alice' }, fail }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [{ userName: 'Alice' }],
    });

    expect(iterator.throw('员工工号非必填,若填写且长度必须在10个数字以内 []')).toEqual({
      value: undefined,
      done: true,
    });
    expect(fail).toHaveBeenCalledWith({
      msg: '员工工号非必填,若填写且长度必须在10个数字以内 []',
    });
  });

  it('updateUser routes thrown Error messages to fail callback', () => {
    const fail = jest.fn();
    const iterator = effects.updateUser({ payload: { userId: 1 }, fail }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [{ userId: 1 }],
    });

    expect(iterator.throw(new Error('更新失败'))).toEqual({
      value: undefined,
      done: true,
    });
    expect(fail).toHaveBeenCalledWith({
      msg: '更新失败',
    });
  });

  it('searchUser routes request exceptions to fail callback', () => {
    const fail = jest.fn();
    const iterator = effects.searchUser({ payload: { userId: 2 }, fail }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'call',
      fn: expect.any(Function),
      args: [{ userId: 2 }],
    });

    expect(iterator.throw({ msg: '查询失败' })).toEqual({
      value: undefined,
      done: true,
    });
    expect(fail).toHaveBeenCalledWith({
      msg: '查询失败',
    });
  });
});
