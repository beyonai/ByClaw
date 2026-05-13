jest.mock('@/pages/manager/service/session', () => ({}));

jest.mock('@/pages/manager/utils/menu', () => ({
  convertFlattenMenuToTreeData: jest.fn(),
}));

jest.mock('@/pages/manager/utils/auth', () => ({
  isAdminVip: jest.fn(),
  getSessionKey: jest.fn(),
  sessionKey: 'SESSION',
}));

import { isAdminVip } from '@/pages/manager/utils/auth';
import { addAdminvipRole } from '../session';

const mockIsAdminVip = isAdminVip as jest.MockedFunction<typeof isAdminVip>;

describe('manager/models/session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addAdminvipRole', () => {
    it('appends the adminvip organization for adminvip users', () => {
      mockIsAdminVip.mockReturnValue(true);
      const userInfo = {
        usersOrganizations: [{ orgId: 1, orgName: 'default' }],
      };

      const result = addAdminvipRole(userInfo);

      expect(result.usersOrganizations).toEqual([
        { orgId: 1, orgName: 'default' },
        {
          orgId: -1,
          orgName: 'adminvip',
          positionId: 1,
          positionName: 'adminvip',
          userType: 'ADMIN',
          pathCode: '-1.-1',
          pathName: 'adminvip',
        },
      ]);
    });

    it('leaves non-adminvip users unchanged', () => {
      mockIsAdminVip.mockReturnValue(false);
      const userInfo = {
        usersOrganizations: [{ orgId: 1, orgName: 'default' }],
      };

      expect(addAdminvipRole(userInfo)).toEqual(userInfo);
    });

    it('handles missing usersOrganizations safely', () => {
      mockIsAdminVip.mockReturnValue(true);
      const userInfo = {};

      expect(addAdminvipRole(userInfo)).toEqual(userInfo);
    });
  });
});
