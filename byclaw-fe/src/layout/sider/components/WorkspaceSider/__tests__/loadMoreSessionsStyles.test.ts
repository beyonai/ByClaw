import fs from 'fs';
import path from 'path';

describe('workspace session load-more dividers', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('adds equally flexible light dashed lines on both sides of the label', () => {
    const dividerStyles = styles.match(/\.loadMoreSessionsDivider\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(dividerStyles).toMatch(/&::before,\s*&::after\s*\{/);
    expect(dividerStyles).toMatch(/content:\s*'';/);
    expect(dividerStyles).toMatch(/flex:\s*1;/);
    expect(dividerStyles).toMatch(/border-top:\s*1px dashed #e5e5e4;/);

    const labelStyles = styles.match(/\.loadMoreSessionsLabel\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(labelStyles).toMatch(/flex:\s*0 0 auto;/);
    expect(source).toMatch(
      /<span className=\{styles\.loadMoreSessionsLabel\}>\s*\{sessionState\.loadingMore \? <LoadingOutlined spin \/> : null\}\s*\{intl\.formatMessage\(\{ id: 'workspaceSider\.loadMore' \}\)\}/
    );
  });

  it('scopes the decoration to load-more and preserves the collapse button style', () => {
    const loadMoreButton = source.match(/\{hasMoreSessions && \(([\s\S]*?)\n        \)\}/)?.[1];
    const collapseButton = source.match(/\{canCollapseSessions && \(([\s\S]*?)\n        \)\}/)?.[1];

    expect(loadMoreButton).toContain('classNames(styles.loadMoreSessions, styles.loadMoreSessionsDivider)');
    expect(loadMoreButton).toContain('classNames(styles.sessionListAction, styles.loadMoreSessionsAction)');
    expect(loadMoreButton).toContain('disabled={sessionState.loadingMore}');
    expect(collapseButton).toContain('className={styles.loadMoreSessions}');
    expect(collapseButton).not.toContain('loadMoreSessionsDivider');
    expect(collapseButton).not.toContain('loadMoreSessionsAction');
  });

  it('aligns the left divider with session names and leaves space at the list edge', () => {
    const sessionStyles = styles.match(/\.sessionItem\s*\{([\s\S]*?)\n\}/)?.[1];
    const sessionLeftPadding = sessionStyles?.match(/padding:\s*0\s+8px\s+0\s+(\d+px);/)?.[1];
    const actionStyles = styles.match(/\.loadMoreSessionsAction\s*\{([\s\S]*?)\n\}/)?.[1];
    const dividerLeftPadding = actionStyles?.match(/padding-left:\s*(\d+px);/)?.[1];

    expect(sessionLeftPadding).toBeDefined();
    expect(dividerLeftPadding).toBe(sessionLeftPadding);
    expect(parseInt(dividerLeftPadding || '0', 10)).toBeGreaterThan(0);
  });
});
