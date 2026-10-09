import fs from 'fs';
import path from 'path';

// 锁定历史审核列表必须展示最终审核结果，避免只显示处理时间而丢失通过/驳回结论。
describe('employee approval history result', () => {
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, '../../../components/Resources/components/ResourceAuditCenter/index.tsx'),
    'utf8'
  );
  const zhLocaleSource = fs.readFileSync(path.resolve(__dirname, '../../../locales/zh-CN.ts'), 'utf8');
  const historyAuditBlock = pageSource.slice(
    pageSource.indexOf("if (auditFilter === 'history')"),
    pageSource.indexOf('} else {', pageSource.indexOf("if (auditFilter === 'history')"))
  );

  it('renders audit result from the existing apply status in history tab', () => {
    expect(historyAuditBlock).toContain("id: 'resourceCenter.processedTime'");
    expect(historyAuditBlock).toContain("id: 'resourceCenter.auditResult'");
    expect(historyAuditBlock).toContain("dataIndex: 'applyStatus'");
  });

  it('uses the Chinese audit result label', () => {
    expect(zhLocaleSource).toContain("'myEmployees.auditResult': '审核结果'");
  });

  it('renders the auditor returned by the history query', () => {
    expect(historyAuditBlock).toContain("id: 'resourceCenter.auditor'");
    expect(historyAuditBlock).toContain("dataIndex: 'auditUserName'");
  });
});
