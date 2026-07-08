import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import JsonRenderer from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

describe('JsonRenderer', () => {
  it('collapses long string values and toggles the full value', () => {
    const longValue = 'a'.repeat(201);
    const collapsedValue = `"${'a'.repeat(200)}`;

    render(<JsonRenderer data={longValue} />);

    expect(screen.getByText(collapsedValue, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(`"${longValue}"`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开完整字符串' }));

    expect(screen.getByText(`"${longValue}"`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起字符串' }));

    expect(screen.getByText(collapsedValue, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(`"${longValue}"`)).not.toBeInTheDocument();
  });
});
