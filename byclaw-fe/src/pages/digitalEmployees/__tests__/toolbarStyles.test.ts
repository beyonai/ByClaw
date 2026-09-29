import fs from 'fs';
import path from 'path';

describe('digital employee toolbar alignment', () => {
  it('keeps search, filter and action buttons at the same height within the toolbar', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const page = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const filter = fs.readFileSync(
      path.resolve(__dirname, '../../../components/Resources/components/ResourceFilter/index.tsx'),
      'utf8'
    );

    // 样式约束仅作用于此页工具栏，同时确保共享筛选组件将页面样式传给触发器。
    expect(page).toContain('<Space className={styles.toolbar}>');
    expect(page).toContain('className={styles.toolbarFilter}');
    expect(page).toContain('className={styles.searchInput}');
    expect(filter).toContain("classnames(styles.relatedToMeDropdown, 'ub ub-ac ub-pj gap8 pointer', className)");
    expect(styles).toMatch(
      /\.toolbar\s*\{[^{}]*\.searchInput,\s*\.toolbarFilter,\s*:global\(\.@\{antPrefix\}-btn\)\s*\{\s*box-sizing: border-box;\s*height: 32px;/
    );
  });
});
