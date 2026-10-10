import { render, screen } from '@testing-library/react';
import { FilePreview } from './FilePreview';

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/workSpace', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/Preview/Twins', () => ({ type, title }: { type?: string; title?: string }) => (
  <div data-testid="file-preview" data-type={type}>
    {title}
  </div>
));

describe('achievement file preview formats', () => {
  it.each([
    ['SVG', 'svg'],
    ['JPEG', 'jpg'],
    ['ico', 'ico'],
    ['avif', 'avif'],
    ['csv', 'csv'],
    ['tsv', 'tsv'],
    ['xls', 'xls'],
    ['webm', 'webm'],
    ['mp3', 'mp3'],
    ['HTM', 'html'],
    ['pdf', 'pdf'],
    ['md', 'md'],
    ['docx', 'docx'],
    ['xlsx', 'xlsx'],
    ['pptx', 'pptx'],
  ])('opens %s through the shared renderer', async (type, expected) => {
    render(<FilePreview fileInfo={{ type, name: `file.${type}` }} />);
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-type', expected);
  });

  it('infers SVG from the filename when the backend has no type', async () => {
    render(<FilePreview fileInfo={{ name: 'diagram.svg' }} />);
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-type', 'svg');
  });
});
