export function stripMarkdownFrontMatter(content?: string) {
  if (!content) return content;
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const firstLineEnd = source.indexOf('\n');
  if (firstLineEnd < 0 || source.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return content;

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf('\n', lineStart);
    const end = lineEnd < 0 ? source.length : lineEnd;
    if (source.slice(lineStart, end).replace(/\r$/, '') === '---') {
      return source.slice(lineEnd < 0 ? end : end + 1);
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }

  return content;
}
