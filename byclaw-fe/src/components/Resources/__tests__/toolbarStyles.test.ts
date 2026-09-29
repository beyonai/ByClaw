import fs from 'fs';
import path from 'path';

describe('resource toolbar control dimensions', () => {
  it('keeps the audit badge label at the same font size as the other tabs', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const secondaryTabs = styles.slice(styles.indexOf('.secondaryTabs {'), styles.indexOf('.wrapper {'));
    const tabButton = secondaryTabs.match(/\.@\{antPrefix\}-tabs-tab-btn\s*\{([\s\S]*)/)?.[1] || '';
    const badge = tabButton.match(/> \.@\{antPrefix\}-badge\s*\{([^}]+)\}/)?.[1] || '';

    // 仅覆盖标签外层容器，避免把待审核数量角标也放大为 tab 字号。
    expect(tabButton).toContain('font-size: 16px;');
    expect(badge).toContain('font-size: inherit;');
    expect(badge).toContain('line-height: inherit;');
    expect(secondaryTabs).not.toContain('-badge-count');
  });

  it('keeps the search, filter and my resources button at the same outer height', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const filterStyles = fs.readFileSync(
      path.resolve(__dirname, '../components/ResourceFilter/index.module.less'),
      'utf8'
    );
    const search = styles.match(/\.searchInput\s*\{([^}]+)\}/)?.[1] || '';
    const filter = filterStyles.match(/\.relatedToMeDropdown\s*\{([^}]+)\}/)?.[1] || '';
    const button = styles.match(/\.installedButton\s*\{([^}]+)\}/)?.[1] || '';

    // 包含边框和内边距的外框高度必须一致，避免筛选标签将入口撑高。
    [search, filter].forEach((control) => {
      expect(control).toContain('box-sizing: border-box;');
      expect(control).toContain('height: 32px;');
    });
    expect(button).toContain('height: 32px;');
    expect(filter).toContain('padding: 0 8px;');
  });
});
