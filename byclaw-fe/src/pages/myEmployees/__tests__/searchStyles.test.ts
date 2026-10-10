import fs from 'fs';
import path from 'path';

describe('my employees search appearance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');

  it('uses an inline trailing search icon in employee management', () => {
    expect(source).not.toContain('<Input.Search');
    expect(source).toContain('suffix={<SearchOutlined onClick={() => void loadEmployees()} />}');
    // 替换独立搜索按钮后仍保留回车搜索入口。
    expect(source).toContain('onPressEnter={() => void loadEmployees()}');
  });

  it('shares the available employee search dimensions across all tabs', () => {
    expect(styles).toMatch(
      /\.employeeSearch,\s*\.auditSearch\s*\{[^}]*box-sizing: border-box;\s*width: 200px;\s*height: 32px;/
    );
  });

  it('places search at the right of the tabs while retaining a separate filter row', () => {
    const filters = styles.match(/\.filters\s*\{([^}]+)\}/)?.[1] || '';

    // JSDOM 不计算布局，锁定 tab 右侧的搜索入口及下方独立筛选行。
    expect(source).toContain('tabBarExtraContent={{ right: employeeSearch }}');
    expect(filters).toContain('width: 100%;');
    expect(filters).toContain('justify-content: space-between;');
    expect(filters).toContain('margin-bottom: 0;');
    expect(styles).not.toContain('.rightFilters');
    expect(source).not.toContain('Segmented');
  });
});
