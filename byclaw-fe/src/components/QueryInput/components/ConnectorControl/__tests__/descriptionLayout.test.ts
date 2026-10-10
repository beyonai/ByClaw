import fs from 'fs';
import path from 'path';

describe('connector description layout in the resource popover', () => {
  const connectorStyles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const connectorSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  const popoverStyles = fs.readFileSync(
    path.resolve(__dirname, '../../../RichInput/mentionPopover/index.module.less'),
    'utf8'
  );
  const popoverSource = fs.readFileSync(path.resolve(__dirname, '../../../RichInput/mentionPopover/index.tsx'), 'utf8');

  // JSDOM 不计算 Less 布局；保护弹窗到文本的宽度约束，实际省略效果需浏览器验证。
  it('constrains plus and mention menus instead of sizing them from the longest description', () => {
    const menu = popoverStyles.match(/\.contentInnerResourceMenu\s*\{([^}]+)/)?.[1] || '';

    expect(popoverSource).toContain("const isAtPopover = type === '@';");
    expect(popoverSource).toMatch(
      /classNames\(styles\.contentInner,\s*\{\s*\[styles\.contentInnerResourceMenu\]: isAtPopover/
    );
    expect(menu).toContain('width: 100%;');
    expect(menu).toContain('min-width: 0;');
    expect(menu).toContain('max-width: 100%;');
    expect(menu).not.toMatch(/width:\s*fit-content\s*;/);
  });

  it('keeps inline rows within the available panel width without modal negative margins', () => {
    const list = connectorStyles.match(/\.connectorListInline\s*\{([\s\S]*?)^\}/m)?.[1] || '';
    const row = list.match(/\.connectorItem\s*\{([^}]+)/)?.[1] || '';

    expect(connectorSource).toContain('classNames(styles.connectorList, styles.connectorListInline)');
    expect(list).toContain('width: 100%;');
    expect(list).toContain('min-width: 0;');
    expect(list).toContain('margin: 0;');
    expect(list).toContain('overflow-y: auto;');
    expect(row).toContain('width: 100%;');
    expect(row).toContain('box-sizing: border-box;');
  });

  it('allows text to shrink beside fixed icons and actions while retaining the full description', () => {
    const content = connectorStyles.match(/\.connectorContent\s*\{([\s\S]*?)^\}/m)?.[1] || '';
    const text = content.match(/span\s*\{([^}]+)/)?.[1] || '';

    expect(content).toContain('min-width: 0;');
    expect(text).toContain('overflow: hidden;');
    expect(text).toContain('text-overflow: ellipsis;');
    expect(text).toContain('white-space: nowrap;');
    expect(connectorSource).toContain('<span className={styles.connectorDescription} title={connector.description}>');
    ['connectorIcon', 'connectorAction'].forEach((className) => {
      const rule = connectorStyles.match(new RegExp(`\\.${className}\\s*\\{([^}]+)`))?.[1] || '';
      expect(rule).toContain('flex: 0 0 auto;');
    });
  });
});
