import enUS from '../../pages/manager/pages/digitalEmployeeMgr/locales/en-US';
import zhCN from '../../pages/manager/pages/digitalEmployeeMgr/locales/zh-CN';

describe('digital employee refinement responsibility messages', () => {
  // 一键生成的职责标题和输入提示应使用统一称谓，避免与工作规范混淆。
  it.each([
    ['refineModal.coreAbility', '岗位职责', 'Job Responsibilities'],
    ['refineModal.abilityNamePlaceholder', '岗位职责{index}名称', 'Job responsibility {index} name'],
    ['refineModal.abilityDescPlaceholder', '请输入岗位职责描述', 'Please enter the job responsibility description'],
    ['refineModal.coreAbilityHint', '数字员工的详细岗位职责', 'Detailed job responsibilities of the digital employee'],
  ])('uses responsibility wording for %s in both locales', (id, chinese, english) => {
    expect(zhCN[id as keyof typeof zhCN]).toBe(chinese);
    expect(enUS[id as keyof typeof enUS]).toBe(english);
  });

  // 弹窗说明与详情页悬浮提示保持一致，避免再次出现两套职责说明。
  it('matches the employee detail responsibility hint', () => {
    expect(zhCN['refineModal.coreAbilityHint']).toBe(zhCN['employeeDetail.coreAbilityHint']);
    expect(enUS['refineModal.coreAbilityHint']).toBe(enUS['employeeDetail.coreAbilityHint']);
  });
});
