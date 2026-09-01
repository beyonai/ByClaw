export type DiffLineKind = 'context' | 'addition' | 'deletion';

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  originalLineNumber?: number;
  modifiedLineNumber?: number;
};

export type DiffDisplayItem =
  | { type: 'line'; line: DiffLine; index: number }
  | { type: 'collapsed'; lines: DiffLine[]; startIndex: number; endIndex: number };

type DiffOperation = Pick<DiffLine, 'kind' | 'text'>;

const MAX_LCS_CELLS = 2_000_000;
const DEFAULT_CONTEXT_LINES = 3;

const splitLines = (content: string | null) => {
  if (!content) return [];
  return content.replace(/\r\n?/g, '\n').split('\n');
};

const buildMiddleDiff = (original: string[], modified: string[]): DiffOperation[] => {
  if (!original.length) return modified.map((text) => ({ kind: 'addition', text }));
  if (!modified.length) return original.map((text) => ({ kind: 'deletion', text }));

  // 极大文件避免构造过大的动态规划矩阵；仍保留明确的删除块和新增块。
  if (original.length * modified.length > MAX_LCS_CELLS) {
    return [
      ...original.map<DiffOperation>((text) => ({ kind: 'deletion', text })),
      ...modified.map<DiffOperation>((text) => ({ kind: 'addition', text })),
    ];
  }

  const lengths = Array.from({ length: original.length + 1 }, () => new Uint32Array(modified.length + 1));
  for (let originalIndex = original.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let modifiedIndex = modified.length - 1; modifiedIndex >= 0; modifiedIndex -= 1) {
      lengths[originalIndex][modifiedIndex] =
        original[originalIndex] === modified[modifiedIndex]
          ? lengths[originalIndex + 1][modifiedIndex + 1] + 1
          : Math.max(lengths[originalIndex + 1][modifiedIndex], lengths[originalIndex][modifiedIndex + 1]);
    }
  }

  const operations: DiffOperation[] = [];
  let originalIndex = 0;
  let modifiedIndex = 0;
  while (originalIndex < original.length && modifiedIndex < modified.length) {
    if (original[originalIndex] === modified[modifiedIndex]) {
      operations.push({ kind: 'context', text: original[originalIndex] });
      originalIndex += 1;
      modifiedIndex += 1;
    } else if (lengths[originalIndex + 1][modifiedIndex] >= lengths[originalIndex][modifiedIndex + 1]) {
      operations.push({ kind: 'deletion', text: original[originalIndex] });
      originalIndex += 1;
    } else {
      operations.push({ kind: 'addition', text: modified[modifiedIndex] });
      modifiedIndex += 1;
    }
  }
  while (originalIndex < original.length) {
    operations.push({ kind: 'deletion', text: original[originalIndex] });
    originalIndex += 1;
  }
  while (modifiedIndex < modified.length) {
    operations.push({ kind: 'addition', text: modified[modifiedIndex] });
    modifiedIndex += 1;
  }
  return operations;
};

export const createLineDiff = (originalContent: string | null, modifiedContent: string | null): DiffLine[] => {
  const original = splitLines(originalContent);
  const modified = splitLines(modifiedContent);
  let prefixLength = 0;
  while (
    prefixLength < original.length &&
    prefixLength < modified.length &&
    original[prefixLength] === modified[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < original.length - prefixLength &&
    suffixLength < modified.length - prefixLength &&
    original[original.length - suffixLength - 1] === modified[modified.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const prefix = original.slice(0, prefixLength).map<DiffOperation>((text) => ({ kind: 'context', text }));
  const originalMiddle = original.slice(prefixLength, original.length - suffixLength);
  const modifiedMiddle = modified.slice(prefixLength, modified.length - suffixLength);
  const suffix = original
    .slice(original.length - suffixLength)
    .map<DiffOperation>((text) => ({ kind: 'context', text }));
  const operations = [...prefix, ...buildMiddleDiff(originalMiddle, modifiedMiddle), ...suffix];

  let originalLineNumber = 1;
  let modifiedLineNumber = 1;
  return operations.map((operation) => {
    const line: DiffLine = { ...operation };
    if (operation.kind !== 'addition') {
      line.originalLineNumber = originalLineNumber;
      originalLineNumber += 1;
    }
    if (operation.kind !== 'deletion') {
      line.modifiedLineNumber = modifiedLineNumber;
      modifiedLineNumber += 1;
    }
    return line;
  });
};

/**
 * 按 unified diff 的方式保留变更前后上下文，并将较远的连续未变更行折叠为一个区段。
 */
export const createDiffDisplayItems = (lines: DiffLine[], contextLines = DEFAULT_CONTEXT_LINES): DiffDisplayItem[] => {
  const visible = new Array(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    for (let visibleIndex = start; visibleIndex <= end; visibleIndex += 1) {
      visible[visibleIndex] = true;
    }
  });

  const items: DiffDisplayItem[] = [];
  let index = 0;
  while (index < lines.length) {
    if (visible[index] || lines[index].kind !== 'context') {
      items.push({ type: 'line', line: lines[index], index });
      index += 1;
      continue;
    }

    const startIndex = index;
    while (index < lines.length && !visible[index] && lines[index].kind === 'context') {
      index += 1;
    }
    items.push({
      type: 'collapsed',
      lines: lines.slice(startIndex, index),
      startIndex,
      endIndex: index - 1,
    });
  }
  return items;
};
