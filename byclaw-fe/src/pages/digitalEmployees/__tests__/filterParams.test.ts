import { buildDigitalEmployeeFilterParam } from '../filterParams';

// 四种筛选必须在服务端分页前生效，不能只过滤当前页卡片。
describe('available employee filter params', () => {
  it.each<[string, Record<string, string | boolean>]>([
    ['PERSONAL_GROUP', { ownerType: 'personal', agentType: '017' }],
    ['ENTERPRISE_GROUP', { ownerType: 'enterprise', agentType: '017' }],
    ['PERSONAL_EMPLOYEE', { ownerType: 'personal', excludeEmployeeGroup: true }],
    ['ENTERPRISE_EMPLOYEE', { ownerType: 'enterprise', excludeEmployeeGroup: true }],
  ])('combines %s with keyword-independent permission filtering', (digitalEmployeeType, expected) => {
    expect(
      buildDigitalEmployeeFilterParam('available', {
        resourceStatus: '2',
        digitalEmployeeType,
        permission: 'AUTHORIZED_TO_ME',
      })
    ).toEqual({ resourceStatus: '2', type: 'authorize', ...expected });
  });

  it('removes type restrictions when selecting all', () => {
    expect(
      buildDigitalEmployeeFilterParam('available', {
        resourceStatus: '2',
        digitalEmployeeType: '',
        permission: 'CREATED_BY_ME',
      })
    ).toEqual({ resourceStatus: '2', type: 'owner' });
  });

  it('passes the authorized-only filter to both server-side paginated lists', () => {
    // 创建者排除由服务端完成，避免前端过滤导致分页总数与列表不一致。
    expect(buildDigitalEmployeeFilterParam('available', { permission: 'AUTHORIZED_TO_ME' }, 'available')).toEqual({
      type: 'authorize',
    });
    expect(buildDigitalEmployeeFilterParam('official', { permission: 'AUTHORIZED_TO_ME' }, 'official')).toEqual({
      resourceStatus: '2',
      excludeDeleted: true,
      permission: 'AUTHORIZED_TO_ME',
    });
  });

  it.each<[string, Record<string, string | boolean>]>([
    ['PERSONAL_GROUP', { ownerType: 'personal', agentType: '017' }],
    ['ENTERPRISE_GROUP', { ownerType: 'enterprise', agentType: '017' }],
    ['PERSONAL_EMPLOYEE', { ownerType: 'personal', includeEmployeeGroup: false }],
    ['ENTERPRISE_EMPLOYEE', { ownerType: 'enterprise', includeEmployeeGroup: false }],
  ])('filters official recommendations by %s with permission', (digitalEmployeeType, expected) => {
    expect(
      buildDigitalEmployeeFilterParam(
        'official',
        { resourceStatus: '', digitalEmployeeType, permission: 'APPLIED_BY_ME' },
        'official'
      )
    ).toEqual({ resourceStatus: '2', excludeDeleted: true, permission: 'APPLIED_BY_ME', ...expected });
  });

  it('clears official type restrictions when selecting all', () => {
    expect(
      buildDigitalEmployeeFilterParam('official', { resourceStatus: '2', digitalEmployeeType: '' }, 'official')
    ).toEqual({ resourceStatus: '2', excludeDeleted: true });
  });

  it.each([undefined, '', '-1', '0', '1', '2', '3'])(
    'always requests published official employees despite stale status %s',
    (resourceStatus) => {
      expect(
        buildDigitalEmployeeFilterParam(
          'official',
          resourceStatus === undefined ? undefined : { resourceStatus },
          'official'
        )
      ).toEqual({ resourceStatus: '2', excludeDeleted: true });
    }
  );
});
