import { filterMenusByAdminVip, LOG_CENTER_MENU, withLogCenterMenu } from '../menuConfig';

jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));

it('adds one log menu after existing menus and restricts it to adminvip', () => {
  const existing = { path: '/manager/workgroup-templates', name: '工作组模板管理' };
  const menus = withLogCenterMenu([LOG_CENTER_MENU, existing]);
  expect(menus).toEqual([existing, LOG_CENTER_MENU]);
  expect(filterMenusByAdminVip(menus, false).map((item) => item.path)).toEqual([existing.path]);
  expect(filterMenusByAdminVip(menus, true).map((item) => item.path)).toEqual([existing.path, '/manager/logs']);
});
