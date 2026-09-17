import fs from 'fs';
import path from 'path';

// 锁定历史审核列表必须展示最终审核结果，避免只显示处理时间而丢失通过/驳回结论。
describe('my employees audit history result', () => {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  const zhLocaleSource = fs.readFileSync(path.resolve(__dirname, '../../../locales/zh-CN.ts'), 'utf8');
  const historyAuditBlock = pageSource.slice(
    pageSource.indexOf("if (auditFilter === 'history')"),
    pageSource.indexOf("if (auditFilter === 'pending')")
  );

  it('renders audit result from the existing apply status in history tab', () => {
    expect(historyAuditBlock).toContain("id: 'myEmployees.processedTime'");
    expect(historyAuditBlock).toContain("id: 'myEmployees.auditResult'");
    expect(historyAuditBlock).toContain("dataIndex: 'applyStatus'");
  });

  it('uses the Chinese audit result label', () => {
    expect(zhLocaleSource).toContain("'myEmployees.auditResult': '审核结果'");
  });

  it('renders the auditor returned by the history query', () => {
    expect(historyAuditBlock).toContain("id: 'myEmployees.auditor'");
    expect(historyAuditBlock).toContain("dataIndex: 'auditUserName'");
  });
});
