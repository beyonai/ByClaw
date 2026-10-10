import fs from 'fs';
import path from 'path';

// 锁定个人页签请求范围，防止再次通过企业可管理范围引入历史授权的他人员工。
describe('my employees personal list scope', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('uses backend authorization permissions without filtering the personal tab menu', () => {
    expect(source).toContain('hiddenMenuItemKeys: []');
    expect(source).not.toContain("hiddenMenuItemKeys: activeTab === 'personal' ? ['use'] : []");
  });

  it('leaves shelf visibility to backend permissions in both tabs', () => {
    expect(source).toContain('enableDigitalEmployeeLifecycle: true');
  });

  // 两个页签复用同一卡片配置，开启入口的同时必须绑定实际删除回调。
  it('enables delete data and connects the employee deletion handler', () => {
    expect(source).toContain('enableDigitalEmployeeDelete: true');
    expect(source).toContain('onDeleteData: (feedback) => handleDelete(employee, feedback)');
  });

  it('requests owner scope for personal while preserving enterprise scopes', () => {
    expect(source).toContain("enterpriseScope === 'all'");
    expect(source).toContain("? 'ownerOrManager'");
    expect(source).toContain("enterpriseScope === 'created'");
    expect(source).toContain("'managerExcludingOwner'");
    expect(source).toMatch(/await request\(\{[\s\S]*?\btype,/);
  });
});
