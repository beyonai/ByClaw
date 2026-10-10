import fs from 'fs';
import path from 'path';

// 各页签统一消费后端员工操作权限。
describe('available employee lifecycle configuration', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../components/AllDigitalEmployees/index.tsx'), 'utf8');

  it('leaves shelf actions and deletion to backend permissions in every tab', () => {
    expect(source).toContain('enableDigitalEmployeeLifecycle: true');
    expect(source).toContain('enableDigitalEmployeeDelete: true');
  });

  it('uses backend operation permissions without hiding available employee menu entries', () => {
    expect(source).toContain('hiddenMenuItemKeys: []');
    expect(source).not.toContain('digitalEmployeeActionsByPermission:');
  });

  it('does not restrict set default by the employee page or tab', () => {
    expect(source).not.toContain('enableSetDefault:');
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
    expect(pageSource).not.toContain('<ResourceFilter');
    expect(pageSource).not.toContain('statusOptionsOverride=');
  });
});
