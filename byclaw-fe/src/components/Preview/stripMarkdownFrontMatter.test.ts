import { stripMarkdownFrontMatter } from './stripMarkdownFrontMatter';

test('removes a complete YAML front matter block from the start of Markdown', () => {
  expect(stripMarkdownFrontMatter('---\nuserCode: 0027010369\ndocumentKind: original\n---\n# Title')).toBe('# Title');
});

test('supports BOM and CRLF while preserving the Markdown body', () => {
  expect(stripMarkdownFrontMatter('\uFEFF---\r\nuserCode: 7\r\n---\r\nBody\r\n')).toBe('Body\r\n');
});

test('keeps ordinary horizontal rules and incomplete front matter unchanged', () => {
  expect(stripMarkdownFrontMatter('Text\n---\nMore text')).toBe('Text\n---\nMore text');
  expect(stripMarkdownFrontMatter('---\nuserCode: 7\nBody')).toBe('---\nuserCode: 7\nBody');
});
