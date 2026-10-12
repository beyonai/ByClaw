import zhCN from '../zh-CN';
import enUS from '../en-US';

it.each([
  ['workspaceSider.approvalCenter', '审批中心', 'Approval center'],
  ['approvalCenter.employee', '员工申请', 'Employee applications'],
  ['approvalCenter.skill', '技能申请', 'Skill applications'],
  ['approvalCenter.knowledge', '知识申请', 'Knowledge applications'],
  ['approvalCenter.tool', '工具申请', 'Tool applications'],
  ['approvalCenter.searchPlaceholder', '搜索资源名称', 'Search resource name'],
  ['approvalCenter.employeeUse', '使用授权审核', 'Use authorization review'],
  ['approvalCenter.employeePublication', '员工发布审核', 'Employee publication review'],
])('localizes approval center label %s', (key, chinese, english) => {
  expect(zhCN[key as keyof typeof zhCN]).toBe(chinese);
  expect(enUS[key as keyof typeof enUS]).toBe(english);
});

it('directs publication progress hints to the matching approval category', () => {
  expect(zhCN['approvalCenter.employeeUpdatePending']).toContain('审批中心的员工申请');
  expect(enUS['approvalCenter.employeeUpdatePending']).toContain('Employee applications in the approval center');
  expect(zhCN['resource.skillPublicationPendingDescription']).toContain('审批中心的技能申请');
  expect(enUS['resource.skillPublicationPendingDescription']).toContain('Skill applications in the approval center');
});
