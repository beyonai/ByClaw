import fs from 'fs';
import path from 'path';

// 审核中心走独立审批链路，不依赖已删除的卡片审核按钮字段。
describe('audit center permission contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('keeps approve and reject actions independent of card permissions', () => {
    expect(source).not.toContain('canAuditUse');
    expect(source).toContain('queryDigitalEmployeeUseApplyAudit({ history: true })');
    expect(source).toContain("handleAudit(row, 'approve')");
    expect(source).toContain("handleAudit(row, 'reject')");
    expect(source).toContain('await approveUseApply(params)');
    expect(source).toContain('await rejectUseApply(params)');
  });
});
