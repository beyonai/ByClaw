import { fireEvent, render, screen, within } from '@testing-library/react';
import Delimited from './Delimited';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('CSV and TSV table preview', () => {
  it.each(['csv', 'tsv'] as const)('renders %s data as text and preserves the first row', (type) => {
    const separator = type === 'tsv' ? '\t' : ',';
    const content = `Name${separator}Value\n<img src=x onerror=alert(1)>${separator}=1+1`;
    render(<Delimited content={content} type={type} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Name')).toBeVisible();
    expect(within(table).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(within(table).getByText('=1+1')).toBeVisible();
    expect(table.querySelector('img')).toBeNull();
  });

  it('paginates long files and resets the page when a different file is opened', () => {
    const content = Array.from({ length: 51 }, (_, index) => `value-${index}`).join('\n');
    const { rerender } = render(<Delimited content={content} type="csv" />);
    expect(screen.queryByText('value-50')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByText('value-50')).toBeVisible();
    rerender(<Delimited content="new-file,1" type="csv" />);
    expect(screen.getByText('new-file')).toBeVisible();
  });

  it('shows format errors and excessive size as explicit fallbacks', () => {
    const { rerender } = render(<Delimited content={'"unterminated'} type="csv" />);
    expect(screen.getByText('fileRender.delimitedMalformed')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    rerender(<Delimited content={'a'.repeat(2 * 1024 * 1024 + 1)} type="csv" />);
    expect(screen.getByText('fileRender.delimitedTooLarge')).toBeVisible();
  });
});
