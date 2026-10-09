import fs from 'fs';
import path from 'path';

const approvalStyles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
const employeeStyles = fs.readFileSync(path.resolve(__dirname, '../../digitalEmployees/index.module.less'), 'utf8');

function declarations(styles: string, selector: string) {
  const body = styles.split(`${selector} {`)[1]?.split(/\n\s*(?:[>+.]|})/)[0] || '';
  return Object.fromEntries(
    Array.from(body.matchAll(/^\s*([\w-]+):\s*([^;]+);/gm), ([, name, value]) => [name, value])
  );
}

describe('approval center tab appearance', () => {
  it.each(['tabs-tab', 'tabs-tab-btn', 'tabs-ink-bar'])(
    'matches the digital employee %s typography and indicator',
    (part) => {
      const selector = `.@{antPrefix}-${part}`;
      // 直接对照数字员工主页签，避免审批页签样式独立变化后再次不一致。
      const reference = declarations(employeeStyles, selector);
      expect(Object.keys(reference).length).toBeGreaterThan(0);
      expect(declarations(approvalStyles, selector)).toEqual(reference);
    }
  );

  it('uses the same spacing and navigation divider as the digital employee tabs', () => {
    const siblingSelector = '+ .@{antPrefix}-tabs-tab';
    expect(declarations(approvalStyles, siblingSelector)).toEqual(declarations(employeeStyles, siblingSelector));
    expect(declarations(approvalStyles, '.@{antPrefix}-tabs-nav')['font-weight']).toBe(
      declarations(employeeStyles, '.@{antPrefix}-tabs-nav')['font-weight']
    );
    expect(approvalStyles).not.toContain('&::before');
  });

  it('lets badge labels inherit tab typography without overriding pending count styles', () => {
    const inheritedFont = { 'font-size': 'inherit', 'font-weight': 'inherit', 'line-height': 'inherit' };
    expect(declarations(approvalStyles, '> .@{antPrefix}-badge')).toEqual(inheritedFont);
    expect(declarations(approvalStyles, '.tabLabel')).toEqual(inheritedFont);
    expect(approvalStyles).not.toContain('-badge-count');
  });

  it('reserves space for floating badges inside the horizontally clipped tab navigation', () => {
    const list = declarations(approvalStyles, '.@{antPrefix}-tabs-nav-list');
    const tab = declarations(approvalStyles, '.@{antPrefix}-tabs-tab');
    const tabTopPadding = parseFloat(tab.padding);
    // small 角标高 14px，向上偏移 2px，另留 1px 阴影空间。
    expect(parseFloat(list['padding-top']) + tabTopPadding).toBeGreaterThanOrEqual(14 / 2 + 2 + 1);
    // 最后一个工具页签也需为多位数字角标预留右侧空间。
    expect(parseFloat(list['padding-right'])).toBeGreaterThanOrEqual(24);
    expect(approvalStyles).not.toMatch(/overflow(?:-x|-y)?:\s*visible/);
  });
});
