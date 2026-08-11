jest.mock('../localeRuntime', () => ({ mergeLocaleMessages: jest.fn() }));

jest.mock('@/locales/zh-CN', () => ({}));
jest.mock('@/locales/en-US', () => ({}));

import { normalizeBusinessTerminology, transformTerminologyMessages } from '../terminology';

const expertConfig = {
  'zh-CN': { singular: '专家', plural: '专家', entry: '专家', market: '专家市场' },
  'en-US': { singular: 'Expert', plural: 'Experts', entry: 'Experts', market: 'Expert Marketplace' },
};

describe('business terminology', () => {
  it('normalizes a JSON config and falls back for invalid fields', () => {
    expect(
      normalizeBusinessTerminology(
        JSON.stringify({
          'zh-CN': { singular: ' 专家 ', plural: '', entry: '专家', market: '专家市场' },
          'en-US': { singular: 'Expert', plural: 'Experts', entry: 'Experts', market: 'Expert Marketplace' },
        })
      )
    ).toEqual({
      ...expertConfig,
      'zh-CN': { ...expertConfig['zh-CN'], plural: '数字员工' },
    });
  });

  it('replaces AI employee terms but preserves real employee wording', () => {
    const result = transformTerminologyMessages(
      {
        'employees.title': '员工',
        'menu.operation.dashboard': '员工运营分析',
        'assistantSetting.employeeCall': '数字员工调用',
        'resource.create': '创建数字员工',
        'knowledge.visible': '全公司所有员工可见',
      },
      'zh-CN',
      expertConfig
    );

    expect(result).toEqual({
      'employees.title': '专家',
      'menu.operation.dashboard': '专家运营分析',
      'assistantSetting.employeeCall': '专家调用',
      'resource.create': '创建专家',
      'knowledge.visible': '全公司所有员工可见',
    });
  });

  it('replaces English singular, plural and marketplace wording', () => {
    const result = transformTerminologyMessages(
      {
        title: 'Digital Employees',
        sentence: 'Digital employee created successfully',
        create: 'Create a Digital Employee',
        market: 'Go to Employee Marketplace',
        'employees.title': 'Employees',
        'menu.operation.dashboard': 'Employee Analytics',
        'taskOutline.executeToolOrEmployee': 'Execute Tool/Employee',
        'assistantSetting.employeeCall': 'Employee Call',
      },
      'en-US',
      expertConfig
    );

    expect(result).toEqual({
      title: 'Experts',
      sentence: 'Expert created successfully',
      create: 'Create an Expert',
      market: 'Go to Expert Marketplace',
      'employees.title': 'Experts',
      'menu.operation.dashboard': 'Experts Analytics',
      'taskOutline.executeToolOrEmployee': 'Execute Tool/Experts',
      'assistantSetting.employeeCall': 'Expert Call',
    });
  });
});
