import { canPreviewName, isTextFallbackFile, resolvePreviewType, MAX_TEXT_PREVIEW_SIZE } from './formats';

it.each(['docm', 'xlsm', 'xlsb', 'pptm', 'odt', 'odp', 'bin'])('does not read %s binaries as text', (type) => {
  expect(isTextFallbackFile(`file.${type}`)).toBe(false);
  expect(canPreviewName(`file.${type}`)).toBe(false);
  expect(resolvePreviewType('txt', `file.${type}`)).toBe(type);
});
it.each(['README', '.gitignore', 'Dockerfile', 'custom.config'])(
  'supports safe text candidates consistently: %s',
  (name) => {
    expect(canPreviewName(name)).toBe(true);
    expect(canPreviewName(name, MAX_TEXT_PREVIEW_SIZE + 1)).toBe(false);
    expect(resolvePreviewType(undefined, name)).toBe('txt');
  }
);
it('prefers a known filename over stale text metadata and parses URL suffixes', () => {
  expect(resolvePreviewType('txt', 'report.html')).toBe('html');
  expect(resolvePreviewType('excel', 'report.xlsx')).toBe('xlsx');
  expect(resolvePreviewType('pdf?download=1', 'https://example.com/report.pdf?download=1')).toBe('pdf');
});
