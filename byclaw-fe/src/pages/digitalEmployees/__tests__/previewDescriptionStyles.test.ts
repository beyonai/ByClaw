import fs from 'fs';
import path from 'path';

describe('employee preview description', () => {
  it('preserves line breaks while keeping the three-line preview limit', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const page = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const rule = styles.match(/\.employeePreviewDescription\s*\{([^{}]*)\}/)?.[1];

    // Jest 不加载真实 Less，检查描述节点与多行展示样式的绑定。
    expect(page).toContain('className={styles.employeePreviewDescription}');
    expect(rule).toMatch(/white-space:\s*pre-wrap\s*;/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
    expect(rule).toMatch(/-webkit-line-clamp:\s*3\s*;/);
  });
});
