import type { useIntl } from '@umijs/max';
import enUS from '@/pages/models/locales/en-US';
import zhCN from '@/pages/models/locales/zh-CN';
import { formatModelDetailValue, getModelDetailSections } from './index';

jest.mock('@umijs/max', () => ({}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({}));
jest.mock('@/layout/sider/components/useResourceCenterRouter', () => ({}));
jest.mock('@/hooks/useGlobal', () => ({}));
jest.mock('@/pages/models/service', () => ({}));
jest.mock('@/service/digitalEmployees', () => ({}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({}));
jest.mock('@/service/common/request', () => ({}));
jest.mock('@/pages/manager/service/ModelMgr', () => ({}));
jest.mock('@/pages/manager/service/session', () => ({}));

// 使用真实语言包检查详情渲染数据，确保翻译不会改变模型名称、配置值或未知字段。
const createIntl = (messages: Record<string, string>) =>
  ({
    formatMessage: ({ id }: { id: string }, values: Record<string, unknown> = {}) =>
      messages[id].replace(/\{(\w+)\}/g, (_, key) => String(values[key])),
  } as ReturnType<typeof useIntl>);

describe('model sidebar localization', () => {
  it.each([
    { messages: enUS, title: 'Basic Information', label: 'Model Name', status: 'Enabled', boolean: 'Yes' },
    { messages: zhCN, title: '基础信息', label: '模型名称', status: '已启用', boolean: '是' },
  ])('localizes details as $title', ({ messages, title, label, status, boolean }) => {
    const intl = createIntl(messages);
    const sections = getModelDetailSections(
      { id: 1, displayName: 'MiniMax-M3', status: 'ENABLED', isDefault: 1, customField: 'custom-value' },
      intl
    );
    expect(sections[0].title).toBe(title);
    const items = sections.flatMap((section) => section.items);
    expect(items.find((item) => item.key === 'displayName')).toMatchObject({ label, value: 'MiniMax-M3' });
    expect(items.find((item) => item.key === 'status')?.value).toBe(status);
    expect(formatModelDetailValue(items.find((item) => item.key === 'isDefault')?.value, intl)).toBe(boolean);
    expect(items.find((item) => item.key === 'customField')).toMatchObject({
      label: 'customField',
      value: 'custom-value',
    });
  });

  it('uses the new language when details are rendered again and keeps aliases deduplicated', () => {
    const model = { inParams: { enabled: true }, in_params: { enabled: true }, connectTimeoutSec: 10 };
    const english = getModelDetailSections(model, createIntl(enUS)).flatMap((section) => section.items);
    const chinese = getModelDetailSections(model, createIntl(zhCN)).flatMap((section) => section.items);
    expect(english.filter((item) => ['inParams', 'in_params'].includes(item.key))).toHaveLength(1);
    expect(english.find((item) => item.key === 'connectTimeoutSec')?.value).toBe('10 s');
    expect(chinese.find((item) => item.key === 'connectTimeoutSec')?.value).toBe('10 秒');
    expect(formatModelDetailValue([true, false], createIntl(enUS))).toBe('Yes, No');
    expect(formatModelDetailValue({ enabled: true }, createIntl(enUS))).toBe('{\n  "enabled": true\n}');
  });

  it('provides English search, enable, copy and named success messages', () => {
    const intl = createIntl(enUS);
    expect(enUS['personalModel.search']).toBe('Search models');
    expect(enUS['personalModel.action.enable']).toBe('Enable');
    expect(enUS['personalModel.detail.copySuccess']).toBe('Copied successfully');
    expect(intl.formatMessage({ id: 'personalModel.enableSuccess' }, { name: 'MiniMax-M3' })).toBe(
      'Model MiniMax-M3 enabled successfully'
    );
  });
});
