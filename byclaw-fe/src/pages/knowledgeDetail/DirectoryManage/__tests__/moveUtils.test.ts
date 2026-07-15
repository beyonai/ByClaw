import { collapseNestedMoveSources, isInvalidMoveTarget, normalizeMovePath } from '../moveUtils';

describe('knowledge item move helpers', () => {
  it('normalizes paths and removes duplicate or nested sources covered by a selected directory', () => {
    expect(
      collapseNestedMoveSources([
        { path: '/制度/人事/', isDirectory: true },
        { path: '/制度/人事/考勤.pdf', isDirectory: false },
        { path: '\\制度\\人事', isDirectory: true },
        { path: '/制度/财务.pdf', isDirectory: false },
      ])
    ).toEqual([
      { path: '/制度/人事', isDirectory: true },
      { path: '/制度/财务.pdf', isDirectory: false },
    ]);
  });

  it('rejects moving a directory to itself or one of its descendants', () => {
    expect(isInvalidMoveTarget('/制度/人事', ['/制度/人事'])).toBe(true);
    expect(isInvalidMoveTarget('/制度/人事/归档', ['/制度/人事'])).toBe(true);
    expect(isInvalidMoveTarget('/归档/人事', ['/制度/人事'])).toBe(false);
  });

  it('keeps the root path stable', () => {
    expect(normalizeMovePath('/')).toBe('/');
  });
});
