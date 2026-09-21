import fs from 'fs';
import path from 'path';

// 锁定页面向共享卡片传递的开关，避免再次按整个 available 页签关闭企业下架入口。
describe('available employee lifecycle configuration', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../components/AllDigitalEmployees/index.tsx'), 'utf8');

  it('enables lifecycle for enterprise ownership while retaining official behavior', () => {
    expect(source).toMatch(
      /enableDigitalEmployeeLifecycle:\s*source === 'official' \|\| `\$\{employee\.ownerType \|\| ''\}`\.toLowerCase\(\) === 'enterprise'/
    );
    expect(source).toContain("onUnShelf: () => onChangeShelfStatus(employee, 'unShelf')");
  });

  it('uses employee type tags for both available and official cards', () => {
    expect(source).toContain('showDigitalEmployeeTypeTag: true');
  });

  it('hides status filtering on both employee tabs', () => {
    const pageSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
    expect(pageSource).toMatch(/\bhideStatusFilter\s+digitalEmployeeTypeFilter/);
    expect(pageSource).not.toContain('statusOptionsOverride=');
  });
});
