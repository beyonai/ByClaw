import { hasAnyUserRole } from '../userRole';

describe('hasAnyUserRole', () => {
  it.each(['PLAT_MAN', 'plat_man', 'Plat_Man'])('accepts platform role %s', (role) => {
    expect(hasAnyUserRole([null, 'ORD_USER', role], ['PLAT_MAN'])).toBe(true);
  });

  it('preserves the roles allowed by each caller', () => {
    expect(hasAnyUserRole(['plat_devops'], ['PLAT_MAN'])).toBe(false);
    expect(hasAnyUserRole(['plat_devops'], ['PLAT_MAN', 'PLAT_DEVOPS'])).toBe(true);
    expect(hasAnyUserRole(['PLAT_MAN'], ['plat_man'])).toBe(true);
    expect(hasAnyUserRole(['ORG_MAN', 'BUSINESS_MAN', 'PLAT_MAN_EXTRA'], ['PLAT_MAN'])).toBe(false);
  });

  it('rejects missing roles and an empty allowlist', () => {
    expect(hasAnyUserRole(undefined, ['PLAT_MAN'])).toBe(false);
    expect(hasAnyUserRole([null, undefined, ''], ['PLAT_MAN'])).toBe(false);
    expect(hasAnyUserRole(['PLAT_MAN'], [])).toBe(false);
  });
});
