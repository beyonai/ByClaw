import enUS from '@/locales/en-US/manager';
import zhCN from '@/locales/zh-CN/manager';

describe('model form configuration localization', () => {
  // 两组标题与引导文案保持一致，应用字段迁移后仍与筛选器使用相同业务名称。
  it.each([
    {
      locale: 'zh-CN',
      messages: zhCN,
      basicTitle: '基础配置',
      moreTitle: '更多配置',
      basicExtraTitle: '更多基本信息',
      scope: '应用范围',
      placeholder: '选择应用范围',
      status: '模型状态',
    },
    {
      locale: 'en-US',
      messages: enUS,
      basicTitle: 'Basic configuration',
      moreTitle: 'More configuration',
      basicExtraTitle: 'More basic settings',
      scope: 'Application scope',
      placeholder: 'Select application scope',
      status: 'Model status',
    },
  ])(
    'uses consistent application terminology in $locale',
    ({ messages, basicTitle, moreTitle, basicExtraTitle, scope, placeholder, status }) => {
      expect(messages['modelMgr.modal.basicConfig']).toBe(basicTitle);
      expect(messages['modelMgr.modal.moreConfig']).toBe(moreTitle);
      expect(messages['modelMgr.modal.moreBasicSettings']).toBe(basicExtraTitle);
      expect(messages['modelMgr.modal.ability']).toBe(scope);
      expect(messages['modelMgr.modal.abilityPlaceholder']).toBe(placeholder);
      expect(messages['modelMgr.modal.status']).toBe(status);
      // 筛选器、已选条件和列表卡片共用筛选翻译键，名称须与详情表单一致。
      expect(messages['modelMgr.filterStatus']).toBe(messages['modelMgr.modal.status']);
      expect(messages['modelMgr.filterAbility']).toBe(messages['modelMgr.modal.ability']);
      expect(messages['modelMgr.filterSystem']).toBe(messages['modelMgr.modal.systemTags']);
      const description = messages['modelMgr.modal.basicConfigDesc'].toLowerCase();
      expect(description).toContain(scope.toLowerCase());
      expect(description).toContain(status.toLowerCase());
      expect(description).toContain('api token');
      expect(messages['modelMgr.modal.moreConfigDesc']).toBeTruthy();
      expect(messages['modelMgr.modal.unknownModelHint']).toContain(moreTitle);
      expect(messages['modelMgr.modal.footerHint']).toContain(moreTitle);
      expect(messages['modelMgr.modal.automaticParamsHint']).toContain('65536');
      expect(messages['modelMgr.modal.automaticParamsHint']).toContain('202752');
      expect(messages['modelMgr.modal.presetContextUnspecifiedHint']).toContain('202752');
      expect(messages['modelMgr.modal.unknownModelHint']).toContain('202752');
      expect(messages['modelMgr.modal.kimiCodePresetHint']).toContain('65536');
    }
  );
});
