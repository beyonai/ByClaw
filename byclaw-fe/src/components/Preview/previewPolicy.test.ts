import {
  canPreviewName,
  isTextFallbackFile,
  resolvePreviewType,
  MAX_TEXT_PREVIEW_SIZE,
  PREVIEWABLE_TYPES,
} from './formats';

it.each(['docm', 'xlsm', 'xlsb', 'pptm', 'odt', 'odp', 'bin'])('does not read %s binaries as text', (type) => {
  expect(isTextFallbackFile(`file.${type}`)).toBe(false);
  expect(canPreviewName(`file.${type}`)).toBe(PREVIEWABLE_TYPES.includes(type));
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

it.each([
  ['report.html', 100_000_000],
  ['report.HTM', 100_000_000],
  ['report.h5', 100_000_000],
  ['notes.markdown', 100_000_000],
  ['video.mp4', 100_000_000],
  ['backup.tar.gz', 100_000_000],
  ['backup.zip', 100_000_000],
  ['backup.rar', 100_000_000],
  ['backup.7z', 100_000_000],
  ['server.log', 50_000_000],
  ['drawing.svg', 50_000_000],
  ['report.pdf', 50_000_000],
  ['recording.mp3', 50_000_000],
  ['sheet.xlsx', 50_000_000],
  ['picture.png', 50_000_000],
] as const)('applies the decimal input limit for %s', (name, limit) => {
  expect(canPreviewName(name, limit)).toBe(true);
  expect(canPreviewName(name, limit + 1)).toBe(false);
});
