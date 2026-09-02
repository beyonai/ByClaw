import { createDiffDisplayItems, createLineDiff } from './diff';

describe('createLineDiff', () => {
  it('marks replaced lines and keeps line numbers aligned', () => {
    expect(createLineDiff('first\nold\nlast', 'first\nnew\nlast')).toEqual([
      { kind: 'context', text: 'first', originalLineNumber: 1, modifiedLineNumber: 1 },
      { kind: 'deletion', text: 'old', originalLineNumber: 2 },
      { kind: 'addition', text: 'new', modifiedLineNumber: 2 },
      { kind: 'context', text: 'last', originalLineNumber: 3, modifiedLineNumber: 3 },
    ]);
  });

  it('supports added and deleted files', () => {
    expect(createLineDiff(null, 'created')).toEqual([{ kind: 'addition', text: 'created', modifiedLineNumber: 1 }]);
    expect(createLineDiff('deleted', null)).toEqual([{ kind: 'deletion', text: 'deleted', originalLineNumber: 1 }]);
  });

  it('collapses unchanged lines outside the configured context', () => {
    const original = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    const modified = [...original];
    modified[5] = 'changed line';

    const items = createDiffDisplayItems(createLineDiff(original.join('\n'), modified.join('\n')), 2);
    const collapsedItems = items.filter((item) => item.type === 'collapsed');

    expect(collapsedItems).toHaveLength(2);
    expect(collapsedItems.map((item) => item.lines.length)).toEqual([3, 4]);
    expect(items.filter((item) => item.type === 'line').map((item) => item.line.text)).toEqual([
      'line 4',
      'line 5',
      'line 6',
      'changed line',
      'line 7',
      'line 8',
    ]);
  });
});
