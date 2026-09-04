import { resolveResourceInstallTargetContext } from '../resourceInstallContext';

describe('resolveResourceInstallTargetContext', () => {
  it('uses the explicitly supplied current employee', () => {
    expect(
      resolveResourceInstallTargetContext({
        resourceInstallContext: {
          source: 'currentEmployee',
          digitalEmployeeId: 101,
          digitalEmployeeName: '代码助手',
        },
      })
    ).toEqual({
      mode: 'fixed',
      digitalEmployeeId: '101',
      digitalEmployeeName: '代码助手',
    });
  });

  it('falls back to employee selection when the page has no explicit source context', () => {
    expect(resolveResourceInstallTargetContext(undefined)).toEqual({ mode: 'select' });
  });

  it('does not fall back to employee selection when the current employee id is missing', () => {
    expect(
      resolveResourceInstallTargetContext({
        resourceInstallContext: { source: 'currentEmployee' },
      })
    ).toEqual({ mode: 'unavailable' });
  });
});
