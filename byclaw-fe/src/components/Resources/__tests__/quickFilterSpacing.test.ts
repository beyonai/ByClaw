import fs from 'fs';
import path from 'path';

describe('resource center quick filter spacing', () => {
  it('justifies shared quick filter groups across the row and retains narrow-screen wrapping', () => {
    const styles = fs.readFileSync(
      path.resolve(__dirname, '../components/ResourceQuickFilters/index.module.less'),
      'utf8'
    );

    // JSDOM 不计算布局；保护浏览页和管理页共用的两端对齐与窄屏换行。
    expect(styles).toMatch(/\.container\s*\{[^{}]*justify-content:\s*space-between;/);
    expect(styles).toMatch(/\.container\s*\{[^{}]*flex-wrap:\s*wrap;/);
    expect(styles).not.toMatch(/margin-(?:right|left|inline-start|inline-end):\s*auto;/);
  });

  it('avoids stacking filter and list margins within the resource center', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const listStyles = fs.readFileSync(path.resolve(__dirname, '../components/ResourceList/index.module.less'), 'utf8');

    // 仅覆盖资源中心的筛选行，列表继续保留原有的顶部留白。
    expect(source).toMatch(/<ResourceQuickFilters\s+className=\{styles\.quickFilters\}/);
    expect(styles).toMatch(/\.fileManagerContainer\s*\{[^{}]*>\s*\.quickFilters\s*\{[^{}]*margin-bottom:\s*0;/);
    expect(listStyles).toMatch(/\.sectionsContainer\s*\{[^{}]*margin:\s*20px 0;/);
  });

  it('places management search last in the right-side tab actions', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');

    // 保护共用页签行的右侧插槽，搜索位于其他管理操作之后。
    expect(source).toMatch(/right:\s*\([\s\S]*?<div className=\{styles\.myResourcesTabActions\}/);
    expect(source).toMatch(/myResourcesTabActions\}>\s*\{tabBarExtraContent\}\s*\{resourceSearch\}/);
    expect(source).not.toContain('styles.myResourcesToolbar');
    expect(styles).not.toContain('.myResourcesToolbar');
  });

  it('justifies management filters across the full row without adding list spacing', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const listStyles = fs.readFileSync(path.resolve(__dirname, '../components/ResourceList/index.module.less'), 'utf8');
    const filters = styles.match(/\.myResourcesFilters\s*\{([^}]+)\}/)?.[1] || '';

    // JSDOM 不计算布局；管理筛选必须占满整行，并保留原有列表间距。
    expect(filters).toContain('width: 100%;');
    expect(filters).toContain('justify-content: space-between;');
    expect(filters).not.toMatch(/margin-top:/);
    expect(filters).toContain('margin-bottom: 0;');
    expect(listStyles).toMatch(/\.sectionsContainer\s*\{[^{}]*margin:\s*20px 0;/);
  });
});
