import fs from 'fs';
import path from 'path';

describe('my employees search appearance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');

  it('uses an inline trailing search icon in employee management', () => {
    expect(source).not.toContain('<Input.Search');
    expect(source).toContain('className={styles.searchButton}');
    expect(source).toContain('onClick={searchEmployees}');
    // 替换独立搜索按钮后仍保留回车搜索入口。
    expect(source).toContain('onPressEnter={searchEmployees}');
  });

  it('restores the shared search dimensions and input theme across both tabs', () => {
    const searchStyles = styles.match(/\.employeeSearch,\s*\.auditSearch\s*\{([^}]+)\}/)?.[1] || '';

    // 保持原有紧凑尺寸，避免管理页再次覆盖统一输入框主题。
    expect(searchStyles).toContain('width: 200px;');
    expect(searchStyles).toContain('height: 32px;');
    expect(searchStyles).toContain('max-width: 100%;');
    const employeeSearchRules = styles.match(/\.employeeSearch(?:,\s*\.auditSearch)?\s*\{[^}]*\}/g) || [];
    employeeSearchRules.forEach((rule) => {
      expect(rule).not.toMatch(/border-color:|border-radius:|font-size:/);
      expect(rule).not.toMatch(/width: 232px;|height: 35px;/);
    });
  });

  it('places search at the right of the tabs while retaining a separate filter row', () => {
    const filters = styles.match(/\.filters\s*\{([^}]+)\}/)?.[1] || '';

    // JSDOM 不计算布局，锁定 tab 右侧的搜索入口及下方独立筛选行。
    expect(source).toContain('tabBarExtraContent={{ right: employeeTools }}');
    expect(filters).toContain('width: 100%;');
    expect(filters).toContain('justify-content: flex-start;');
    expect(filters).toContain('margin-bottom: 0;');
    expect(styles).not.toContain('.rightFilters');
    expect(source).not.toContain('Segmented');
    expect(styles).toContain('@media (max-width: 760px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
  });
});
