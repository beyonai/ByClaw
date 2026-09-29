import fs from 'fs';
import path from 'path';

describe('my employees search appearance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');

  it('uses an inline trailing search icon in employee and audit tabs', () => {
    expect(source).not.toContain('<Input.Search');
    expect(source).toContain('suffix={<SearchOutlined onClick={() => void loadEmployees()} />}');
    expect(source).toContain('suffix={<SearchOutlined />}');
    // 替换独立搜索按钮后仍保留回车搜索入口。
    expect(source).toContain('onPressEnter={() => void loadEmployees()}');
  });

  it('shares the available employee search dimensions across all tabs', () => {
    expect(styles).toMatch(
      /\.employeeSearch,\s*\.auditSearch\s*\{[^}]*box-sizing: border-box;\s*width: 200px;\s*height: 32px;/
    );
  });
});
