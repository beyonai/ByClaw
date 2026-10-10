import fs from 'fs';
import path from 'path';

describe('resource center quick filter spacing', () => {
  it('aligns all quick filter groups to the right without separating business types', () => {
    const styles = fs.readFileSync(
      path.resolve(__dirname, '../components/ResourceQuickFilters/index.module.less'),
      'utf8'
    );

    // JSDOM 不计算布局；防止业务类型的自动外边距再次将整行拆成左右两组。
    expect(styles).toMatch(/\.container\s*\{[^{}]*justify-content:\s*flex-end;/);
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

  it('uses only the list top margin below the shared resource management toolbar', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const listStyles = fs.readFileSync(path.resolve(__dirname, '../components/ResourceList/index.module.less'), 'utf8');
    const toolbar = styles.slice(styles.indexOf('.myResourcesToolbar {'), styles.indexOf('.installedTabs {'));

    // JSDOM 不计算间距，保护三个管理模块共用的工具栏与列表间距。
    expect(source).toMatch(/myResourcesOnly\s*&&\s*\(\s*<div className=\{styles\.myResourcesToolbar\}/);
    expect(toolbar).toMatch(/^[^{}]*\{[^{}]*margin-bottom:\s*0;/);
    expect(toolbar).not.toContain('mySkillsToolbar');
    expect(listStyles).toMatch(/\.sectionsContainer\s*\{[^{}]*margin:\s*20px 0;/);
  });
});
