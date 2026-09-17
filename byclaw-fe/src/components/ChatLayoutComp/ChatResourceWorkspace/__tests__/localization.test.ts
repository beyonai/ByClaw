import { readFileSync } from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import enUS from '@/locales/en-US';
import zhCN from '@/locales/zh-CN';

const sourceRoot = path.resolve(__dirname, '../../../..');
const files = [
  'components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel.tsx',
  'components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel.tsx',
  'components/ChatLayoutComp/ChatResourceWorkspace/ResourcePanel.tsx',
  'components/ChatLayoutComp/ChatResourceWorkspace/CodeChangesPanel.tsx',
  'components/ChatLayoutComp/ChatResourceWorkspace/index.tsx',
  'layout/sider/components/FileSiderPanel/components/FileSpaceBlock.tsx',
  'layout/sider/components/FileSiderPanel/components/FileTreeList.tsx',
  'layout/sider/components/FileSiderPanel/components/CreateFolderModal.tsx',
  'components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal.tsx',
];

describe('resource sidebar localization', () => {
  // AST 检查忽略中文注释，同时覆盖 JSX、属性、普通字符串和模板字符串中的遗漏。
  it.each(files)('keeps hardcoded Chinese UI text out of %s', (file) => {
    const ast = parse(readFileSync(path.join(sourceRoot, file), 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const untranslated: string[] = [];
    const check = (text: string) => {
      if (/[\u3400-\u9fff]/.test(text)) untranslated.push(text);
    };
    traverse(ast, {
      StringLiteral: ({ node }) => check(node.value),
      JSXText: ({ node }) => check(node.value),
      TemplateElement: ({ node }) => check(node.value.raw),
    });
    expect(untranslated).toEqual([]);
  });

  // 覆盖动态作用域键，并检查所有侧栏文案在中英文中的参数契约一致。
  it.each(Object.keys(zhCN).filter((key) => key.startsWith('chatResource.')))(
    'provides matching translations and placeholders for %s',
    (key) => {
      const chinese = (zhCN as Record<string, string>)[key];
      const english = (enUS as Record<string, string>)[key];
      expect(english).toBeTruthy();
      expect(english).not.toMatch(/[\u3400-\u9fff]/);
      const parameters = (text: string) =>
        Array.from(text.matchAll(/\{(\w+)(?:\}|,)/g), (match) => match[1]).sort();
      expect(parameters(english)).toEqual(parameters(chinese));
    }
  );

  it('provides English labels for the three folder actions shown in the screenshot', () => {
    expect(enUS['chatResource.uploadFile']).toBe('Upload files');
    expect(enUS['chatResource.createSiblingFolder']).toBe('Create sibling folder');
    expect(enUS['chatResource.createChildFolder']).toBe('Create subfolder');
  });
});
