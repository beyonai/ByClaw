import { parse } from '@babel/parser';
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
  const visit = (node: any, file: string) => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'ObjectProperty' &&
      (node.key.name || node.key.value) === 'id' &&
      node.value.type === 'StringLiteral' &&
      node.value.value.includes('.')
    ) {
      for (const locale of Object.keys(messages)) {
        if (!messages[locale][node.value.value]) {
          missing.push(`${locale}: ${node.value.value} (${path.relative(sourceRoot, file)}:${node.loc.start.line})`);
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, file));
      else if (value && typeof value === 'object') visit(value, file);
    }
  };
  for (const file of files) {
    if (
      file.includes('/locales/') ||
      file.includes('/__tests__/') ||
      file.includes('.test.') ||
      file.endsWith('.d.ts')
    ) {
      continue;
    }
    // 解析 AST 自动排除注释中的已停用代码，避免误报历史文案。
    const ast = parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: file.endsWith('.ts') ? ['typescript'] : ['typescript', 'jsx'],
    });
    visit(ast.program, file);
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
