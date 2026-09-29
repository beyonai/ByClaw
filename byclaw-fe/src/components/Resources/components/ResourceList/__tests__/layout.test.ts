import fs from 'fs';
import path from 'path';

it('reserves the remaining panel height for loading before any cards arrive', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const container = styles.match(/\.sectionsContainer\s*\{([^}]+)/)?.[1] || '';
  const spin = styles.match(/\.spinningWrapper\s*\{([^}]+)/)?.[1] || '';

  // JSDOM 不计算布局：静态保护高度链，避免空列表时嵌套 Spin 再次失去可见高度。
  expect(container).toContain('flex: 1;');
  expect(container).toContain('min-height: 0;');
  expect(container).toContain('overflow-y: auto;');
  expect(spin).toContain('height: 100%;');
});
