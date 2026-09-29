import fs from 'fs';
import path from 'path';

// 浏览页统一关闭管理入口；我的员工页面继续按权限管理生命周期。
describe('available employee lifecycle configuration', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../components/AllDigitalEmployees/index.tsx'), 'utf8');

  it('hides lifecycle actions for available and official employees', () => {
    expect(source).toContain('enableDigitalEmployeeLifecycle: false');
    expect(source).toContain('enableDigitalEmployeeDelete: false');
  });

  it('only opts into set default from the available tab', () => {
    expect(source).toContain("enableSetDefault: source === 'available'");
    const myEmployees = fs.readFileSync(path.resolve(__dirname, '../../myEmployees/index.tsx'), 'utf8');
    expect(myEmployees).not.toContain('enableSetDefault:');
    const sidebarCard = fs.readFileSync(
      path.resolve(__dirname, '../../../layout/sider/components/EmployeeList/EmployeeCard.tsx'),
      'utf8'
    );
    expect(sidebarCard).not.toContain('resource.setDefaultAssistant');
    expect(sidebarCard).not.toContain('setDefaultDigitalEmployee');
  });

  it('uses employee type tags for both available and official cards', () => {
    expect(source).toContain('showDigitalEmployeeTypeTag: true');
  });

  it('hides status filtering on both employee tabs', () => {
    const pageSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    expect(pageSource).toMatch(/\bhideStatusFilter\s+digitalEmployeeTypeFilter/);
    expect(pageSource).not.toContain('statusOptionsOverride=');
  });
});
