import fs from 'fs';
import path from 'path';

it('keeps skill corner tags above the lowered actions and reserves title space', () => {
  // JSDOM 不计算 Less 布局：静态保护角标定位和操作区间距，实际视觉效果需浏览器确认。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const tag = styles.match(/\.skillPosterTag\s*\{([^}]+)/)?.[1] || '';
  const actions = styles.match(/\.skillPosterActions\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const header = styles.match(/\.skillPosterHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions =
    styles.match(/\.resourceInfoWithActions\s+\.skillPosterHeaderWithTag\s*\{([^}]+)/)?.[1] || '';

  expect(tag).toContain('position: absolute;');
  expect(tag).toContain('top: 12px;');
  expect(tag).toContain('right: 14px;');
  expect(actions).toContain('top: auto;');
  expect(actions).toContain('bottom: 12px;');
  expect(actions).toContain('transform: none;');
  expect(actions).toContain('height: 24px;');
  expect(header).toContain('padding-right: 64px;');
  expect(headerWithActions).toContain('padding-right: 16px;');
});
