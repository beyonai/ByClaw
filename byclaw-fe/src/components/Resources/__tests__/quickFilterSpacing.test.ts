import fs from 'fs';
import path from 'path';

describe('resource center quick filter spacing', () => {
  it('avoids stacking filter and list margins within the resource center', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const listStyles = fs.readFileSync(path.resolve(__dirname, '../components/ResourceList/index.module.less'), 'utf8');

    // 仅覆盖资源中心的筛选行，列表继续保留原有的顶部留白。
    expect(source).toMatch(/<ResourceQuickFilters\s+className=\{styles\.quickFilters\}/);
    expect(styles).toMatch(/\.fileManagerContainer\s*\{[^{}]*>\s*\.quickFilters\s*\{[^{}]*margin-bottom:\s*0;/);
    expect(listStyles).toMatch(/\.sectionsContainer\s*\{[^{}]*margin:\s*20px 0;/);
  });
});
