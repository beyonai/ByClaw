import fs from 'fs';
import path from 'path';

describe('digital employee toolbar alignment', () => {
  it('keeps search and action buttons at the same height within the toolbar', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const page = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    // 筛选已移到独立一行，工具栏只约束搜索与操作按钮的外框高度。
    expect(page).toContain('<Space className={styles.toolbar}>');
    expect(page).toContain('className={styles.searchInput}');
    expect(styles).toMatch(
      /\.toolbar\s*\{[^{}]*\.searchInput,\s*:global\(\.@\{antPrefix\}-btn\)\s*\{\s*box-sizing: border-box;\s*height: 32px;/
    );
  });
});
