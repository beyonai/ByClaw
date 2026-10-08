import fs from 'fs';
import path from 'path';

describe('approval navigation migration', () => {
  const readSource = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

  it('places the approval entry directly below resources and gives it an independent active state', () => {
    const sidebar = readSource('../../../layout/sider/components/WorkspaceSider/index.tsx');
    const entry = sidebar.indexOf("onClick={() => navigate('/approvalCenter')}");
    expect(entry).toBeGreaterThan(sidebar.indexOf("onClick={() => navigate('/resourceCenter')}"));
    expect(entry).toBeLessThan(sidebar.indexOf("onClick={() => navigate('/inspiration')}"));
    expect(sidebar).toContain("const approvalCenterActive = isSameOrChildPath(location.pathname, '/approvalCenter');");
    expect(sidebar).toContain('approvalCenterActive && styles.primaryItemActive');
    expect(sidebar).toContain('count={approvalPendingCount}');
    expect(readSource('../../../../config/route.config.ts')).toContain("component: './approvalCenter'");
  });

  it('removes employee approvals and counts from the management and browse pages', () => {
    const employees = readSource('../../myEmployees/index.tsx');
    expect(employees).not.toContain('queryDigitalEmployeeUseApplyAudit');
    expect(employees).not.toContain('PublicationAuditList');
    expect(employees).not.toContain("key: 'audit'");
    const browse = readSource('../../digitalEmployees/index.tsx');
    expect(browse).not.toContain('useDigitalEmployeeAuditCount');
    expect(browse).not.toContain('pendingAuditRows');
  });

  it.each([
    '../../../components/Resources/index.tsx',
    '../../digitalEmployees/components/AllDigitalEmployees/index.tsx',
    '../../digitalEmployees/components/EmployeeRelatedToMe/index.tsx',
  ])('removes the former resource approval drawers from %s', (page) => {
    const source = readSource(page);
    expect(source).not.toContain('UseApplyAuditDrawer');
    expect(source).not.toContain('onAuditUse');
  });
});
