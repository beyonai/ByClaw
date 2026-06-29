import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { Office } from './Office';

const mockExcelPreview = jest.fn(() => Promise.resolve());
const mockExcelRender = jest.fn(() => Promise.resolve());
const mockExcelDestroy = jest.fn();
const mockExcelInit = jest.fn(() => ({
  preview: mockExcelPreview,
  renderExcel: mockExcelRender,
  destroy: mockExcelDestroy,
}));

jest.mock('@js-preview/excel', () => ({
  __esModule: true,
  default: {
    init: mockExcelInit,
  },
}));

describe('Office preview data loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Excel ArrayBuffer directly without the preview helper object URL path', async () => {
    const data = new Blob(['excel content'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    render(<Office data={data} type="xlsx" />);

    await waitFor(() => expect(mockExcelRender).toHaveBeenCalled());

    expect(mockExcelRender.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    expect(mockExcelPreview).not.toHaveBeenCalled();
  });
});
