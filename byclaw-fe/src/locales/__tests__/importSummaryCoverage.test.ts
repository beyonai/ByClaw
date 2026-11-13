import zhCN from '../zh-CN';
import enUS from '../en-US';

// GH-323: ResourceImport 结果汇总条通过三元表达式引用 resource.import.summary
// （components/Resources/components/ResourceImport/index.tsx），通用覆盖测试的
// AST 收集器不解析三元 id，导致该键漏检。这里直接断言两种语言都提供文案。
const KEY = 'resource.import.summary';

describe('GH-323 resource.import.summary coverage', () => {
  it('zh-CN provides the summary message', () => {
    expect(typeof zhCN[KEY]).toBe('string');
    expect(zhCN[KEY]).toContain('{createdCount}');
    expect(zhCN[KEY]).toContain('{updatedCount}');
  });

  it('en-US provides the summary message (fails until the translation is added)', () => {
    expect(typeof enUS[KEY]).toBe('string');
    expect(enUS[KEY]).toContain('{createdCount}');
    expect(enUS[KEY]).toContain('{updatedCount}');
  });
});
