import enUS from '@/locales/en-US/manager';
import zhCN from '@/locales/zh-CN/manager';

describe('model form application configuration localization', () => {
  // 共享模型表单沿用原有翻译键，确保中英文标签、占位符和说明使用一致的业务名称。
  it.each([
    {
      locale: 'zh-CN',
      messages: zhCN,
      title: '应用配置',
      scope: '应用范围',
      placeholder: '选择应用范围',
      status: '模型状态',
    },
    {
      locale: 'en-US',
      messages: enUS,
      title: 'Application configuration',
      scope: 'Application scope',
      placeholder: 'Select application scope',
      status: 'Model status',
    },
  ])('uses consistent application terminology in $locale', ({ messages, title, scope, placeholder, status }) => {
    expect(messages['modelMgr.modal.tagConfig']).toBe(title);
    expect(messages['modelMgr.modal.ability']).toBe(scope);
    expect(messages['modelMgr.modal.abilityPlaceholder']).toBe(placeholder);
    expect(messages['modelMgr.modal.status']).toBe(status);
    // 筛选器、已选条件和列表卡片共用筛选翻译键，名称须与详情表单一致。
    expect(messages['modelMgr.filterStatus']).toBe(messages['modelMgr.modal.status']);
    expect(messages['modelMgr.filterAbility']).toBe(messages['modelMgr.modal.ability']);
    expect(messages['modelMgr.filterSystem']).toBe(messages['modelMgr.modal.systemTags']);
    const description = messages['modelMgr.modal.tagConfigDesc'].toLowerCase();
    expect(description).toContain(scope.toLowerCase());
    expect(description).toContain(status.toLowerCase());
  });
});
