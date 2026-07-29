import { canShowEmployeeChat } from './chatPermission';

describe('employee chat permission', () => {
  it('always shows chat for personal assistants', () => {
    expect(canShowEmployeeChat('personal', '1001', null)).toBe(true);
  });

  it('hides chat for enterprise employees until use permission is confirmed', () => {
    expect(canShowEmployeeChat('enterprise', '1001', null)).toBe(false);
    expect(canShowEmployeeChat('enterprise', '1001', { resourceId: '1001', hasUsePermission: false })).toBe(false);
  });

  it('shows chat only when the current enterprise employee has use permission', () => {
    expect(canShowEmployeeChat('enterprise', '1001', { resourceId: '1001', hasUsePermission: true })).toBe(true);
    expect(canShowEmployeeChat('enterprise', '1001', { resourceId: '1002', hasUsePermission: true })).toBe(false);
  });
});
