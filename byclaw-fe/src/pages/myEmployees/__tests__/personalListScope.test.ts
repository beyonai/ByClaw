import fs from 'fs';
import path from 'path';

// 锁定个人页签请求范围，防止再次通过 manageable 引入历史授权的他人员工。
describe('my employees personal list scope', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('hides use authorization only in the personal tab', () => {
    expect(source).toContain("hiddenMenuItemKeys: activeTab === 'personal' ? ['use'] : []");
  });

  it('enables shelf actions only in the enterprise tab', () => {
    expect(source).toContain("enableDigitalEmployeeLifecycle: activeTab === 'enterprise'");
  });

  // 两个页签复用同一卡片配置，开启入口的同时必须绑定实际删除回调。
  it('enables delete data and connects the employee deletion handler', () => {
    expect(source).toContain('enableDigitalEmployeeDelete: true');
    expect(source).toContain('onDeleteData: () => handleDelete(employee)');
  });

  it('requests owner scope for personal while preserving enterprise scopes', () => {
    expect(source).toMatch(
      /const type\s*=\s*activeTab === 'enterprise'\s*\?\s*\(enterpriseScope === 'created'\s*\?\s*'owner'\s*:\s*'managerExcludingOwner'\)\s*:\s*'owner'/
    );
    expect(source).toMatch(/await request\(\{[\s\S]*?\btype,/);
    expect(source).not.toContain("'manageable'");
  });
});
