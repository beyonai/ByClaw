import { render, screen } from '@testing-library/react';
import IconRender from './index';

jest.mock('@/components/AntdIcon', () => ({ type }: { type: string }) => <span data-testid={type} />);

describe('photo attachment icons', () => {
  it.each([
    'jpg',
    'JFIF',
    'jpe',
    'jif',
    'pjp',
    'pjpeg',
    'heic',
    'heif',
    'HIF',
    'tif',
    'tiff',
    'jxl',
    'JP2',
    'PPM',
    'TGA',
    'png.alpha',
    'avif',
    'apng',
    'raw',
    'dng',
    'cr2',
    'cr3',
    'nef',
    'nrw',
    'arw',
    'srf',
    'sr2',
    'raf',
    'rw2',
    'orf',
    'pef',
    'srw',
  ])('shows an image icon for %s', (fileType) => {
    render(<IconRender fileType={fileType} />);
    expect(screen.getByTestId('icon-Image')).toBeInTheDocument();
  });

  it.each([
    ['doc', 'Word'],
    ['rtf', 'Word'],
    ['ods', 'Excel'],
    ['RTF', 'Word'],
    ['ODS', 'Excel'],
    ['ODT', 'Word'],
    ['ODP', 'PPT'],
    ['IPYNB', 'a-Codedaima'],
    ['DOCM', 'Word'],
    ['DOTX', 'Word'],
    ['XLSM', 'Excel'],
    ['XLTX', 'Excel'],
    ['PPTM', 'PPT'],
    ['PPSX', 'PPT'],
    ['POTX', 'PPT'],
    ['EML', 'jishiben'],
    ['TAR', 'a-Data-fileshujuwenjian'],
    ['TGZ', 'a-Data-fileshujuwenjian'],
    ['tar.gz', 'a-Data-fileshujuwenjian'],
    ['GZ', 'a-Data-fileshujuwenjian'],
    ['zip', 'a-Data-fileshujuwenjian'],
    ['rar', 'a-Data-fileshujuwenjian'],
    ['7z', 'a-Data-fileshujuwenjian'],
    ['csv', 'CSV'],
    ['EPUB', 'Word'],
    ['SQLITE3', 'sql1'],
    ['db', 'sql1'],
    ['pdf', 'PDF'],
  ])('preserves the %s icon', (fileType, icon) => {
    render(<IconRender fileType={fileType} />);
    expect(screen.getByTestId(`icon-${icon}`)).toBeInTheDocument();
  });
});
