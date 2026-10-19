import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import fs from 'fs';
import path from 'path';
import zhCN from '../zh-CN';
import enUS from '../en-US';
import zhPublication from '../zh-CN/employeePublication';
import enPublication from '../en-US/employeePublication';

const sourceRoot = path.resolve(__dirname, '../..');
const sourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === '__mocks__') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
  });

const flattenMessages = (messages: Record<string, any>, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(messages).flatMap(([key, value]) => {
      const id = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string' ? [[id, value]] : Object.entries(flattenMessages(value, id));
    })
  );

const collectMessageReferences = (source: string, file: string): Array<{ id: string; line: number }> => {
  const references: Array<{ id: string; line: number }> = [];
  const collectLiteral = (valuePath: any) => {
    const resolved = valuePath.resolve();
    if (resolved.isStringLiteral()) {
      references.push({ id: resolved.node.value, line: resolved.node.loc.start.line });
    }
  };
  const collectId = (valuePath: any) => {
    const resolved = valuePath.resolve();
    if (resolved.isMemberExpression()) {
      // MODEL_DETAIL_LABELS[key] 仍引用真实文案；按词法作用域解析映射，避免误用同名参数或业务对象。
      const labels = resolved.get('object').resolve();
      if (labels.isObjectExpression()) {
        const key = resolved.node.computed
          ? resolved.get('property').resolve().node.value
          : resolved.node.property.name;
        for (const property of labels.get('properties')) {
          if (
            property.isObjectProperty() &&
            (key === undefined || (property.node.key.name || property.node.key.value) === key)
          ) {
            collectLiteral(property.get('value'));
          }
        }
      }
    } else {
      collectLiteral(valuePath);
    }
  };
  // 解析 AST 自动排除注释中的已停用代码，避免误报历史文案。
  traverse(
    parse(source, {
      sourceType: 'module',
      plugins: file.endsWith('.ts') ? ['typescript'] : ['typescript', 'jsx'],
    }),
    {
      'CallExpression|OptionalCallExpression': (callPath: any) => {
        const { callee } = callPath.node;
        const method = callee.type === 'Identifier' ? callee.name : callee.property?.name || callee.property?.value;
        // 只读取 formatMessage 的文案描述符；模型、资源等业务对象的 id 不是国际化键。
        if (method !== 'formatMessage') return;
        const descriptor = callPath.get('arguments')[0]?.resolve();
        if (!descriptor?.isObjectExpression()) return;
        for (const property of descriptor.get('properties')) {
          if (property.isObjectProperty() && (property.node.key.name || property.node.key.value) === 'id') {
            collectId(property.get('value'));
          }
        }
      },
    }
  );
  return references;
};

it('checks message descriptors without mistaking dotted model IDs or interpolation data for translations', () => {
  const references = collectMessageReferences(
    `
      const presets = [
        { id: 'sensenova:sensenova-6.8-flash-lite' },
        { id: 'bailian:stepfun/step-3.7-flash' },
        { id: 'bailian:kimi-k2.7-code' },
        { id: 'business.record' },
      ];
      intl.formatMessage({ id: 'common.save' }, { id: 'business.interpolation' });
      formatMessage({ 'id': 'missing.translation' });
      getIntl().formatMessage({ id: 'common.cancel' });
      intl?.formatMessage({ id: 'common.optional' });
      intl['formatMessage']({ id: 'common.computed' });
      intl.formatMessage({ id: dynamicId });
      // intl.formatMessage({ id: 'obsolete.comment' });
    `,
    'fixture.ts'
  );
  expect(references.map(({ id }) => id)).toEqual([
    'common.save',
    'missing.translation',
    'common.cancel',
    'common.optional',
    'common.computed',
  ]);
  expect(references[0].line).toBe(8);
});

it('retains constant descriptor and field-label coverage without resolving shadowed variables', () => {
  const references = collectMessageReferences(
    `
      const labels = { id: 'detail.id', name: 'detail.name' };
      const descriptor = { id: 'common.save' };
      intl.formatMessage(descriptor);
      intl.formatMessage({ id: labels[key] });
      intl.formatMessage({ id: labels.id });
      function render(labels) {
        intl.formatMessage({ id: labels[key] });
      }
      const business = { id: 'business.record' };
    `,
    'fixture.ts'
  );
  expect(references.map(({ id }) => id)).toEqual(['common.save', 'detail.id', 'detail.name', 'detail.id']);
});

it('provides both languages for all directly referenced message IDs in active frontend code', () => {
  const files = sourceFiles(sourceRoot);
  const messages: Record<string, Record<string, string>> = { 'zh-CN': { ...zhCN }, 'en-US': { ...enUS } };
  // Umi 会合并各页面的 locales，覆盖检查沿用同一范围，不能只判断根语言包。
  for (const locale of Object.keys(messages)) {
    for (const file of files.filter(
      (file) => file.includes(`${path.sep}locales${path.sep}`) && file.endsWith(`/${locale}.ts`)
    )) {
      Object.assign(messages[locale], flattenMessages(require(file).default));
    }
  }
  const missing: string[] = [];
  for (const file of files) {
    if (
      file.includes('/locales/') ||
      file.includes('/__tests__/') ||
      file.includes('.test.') ||
      file.endsWith('.d.ts')
    ) {
      continue;
    }
    for (const { id, line } of collectMessageReferences(fs.readFileSync(file, 'utf8'), file)) {
      for (const locale of Object.keys(messages)) {
        if (!messages[locale][id]) missing.push(`${locale}: ${id} (${path.relative(sourceRoot, file)}:${line})`);
      }
    }
  }
  expect(missing).toEqual([]);
});

it('keeps publication message IDs and interpolation parameters aligned across languages', () => {
  expect(Object.keys(enPublication).sort()).toEqual(Object.keys(zhPublication).sort());
  for (const key of Object.keys(zhPublication) as Array<keyof typeof zhPublication>) {
    const parameters = (message: string) => (message.match(/\{\w+\}/g) || []).sort();
    expect(parameters(enPublication[key])).toEqual(parameters(zhPublication[key]));
  }
});
