import { readFileSync } from 'fs';
import path from 'path';

const styles = readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');

it('centers local shared file breadcrumb items and their navigation buttons', () => {
  const breadcrumbStyles = styles.match(/\.localSharedBreadcrumb\s*\{([\s\S]*?)\n\}/)?.[1];
  const buttonStyles = styles.match(/\.localSharedBreadcrumbButton\s*\{([^}]*)\}/)?.[1];

  // 同时约束列表和按钮，避免图标再次按行内文字基线偏移。
  expect(breadcrumbStyles).toMatch(/:global\(\.ant-breadcrumb\)\s*\{[^{}]*> ol\s*\{\s*align-items: center;/);
  expect(buttonStyles).toContain('display: inline-flex;');
  expect(buttonStyles).toContain('align-items: center;');
  expect(buttonStyles).toContain('font: inherit;');
});
