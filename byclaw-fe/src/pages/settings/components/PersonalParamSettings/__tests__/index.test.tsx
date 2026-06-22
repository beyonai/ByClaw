import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PersonalParamSettings from '..';
import { queryPersonalParams, savePersonalParam } from '@/service/personalParam';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) => {
      if (id === 'settings.params.valueMaskedTip') {
        return `当前值：${values?.value}`;
      }
      return id;
    },
  }),
}));

jest.mock('@/service/personalParam', () => ({
  queryPersonalParams: jest.fn(),
  savePersonalParam: jest.fn(),
  deletePersonalParam: jest.fn(),
  enablePersonalParam: jest.fn(),
}));

const mockQueryPersonalParams = queryPersonalParams as jest.MockedFunction<typeof queryPersonalParams>;
const mockSavePersonalParam = savePersonalParam as jest.MockedFunction<typeof savePersonalParam>;

describe('PersonalParamSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryPersonalParams.mockResolvedValue({
      list: [
        {
          paramId: 10001,
          key: 'VOLCENGINE_TTS_API_KEY',
          description: 'TTS key',
          status: 'NORMAL',
          enabled: true,
          hasValue: true,
          valueLast4: '8838',
          updateTime: '2026-06-22T17:00:00+08:00',
        },
      ],
      total: 1,
      pageNum: 1,
      pageSize: 10,
    });
    mockSavePersonalParam.mockResolvedValue({
      paramId: 10001,
      key: 'VOLCENGINE_TTS_API_KEY',
      status: 'NORMAL',
      enabled: true,
      hasValue: true,
      valueLast4: '9999',
    });
  });

  it('submits the new parameter value when editing a configured parameter', async () => {
    render(<PersonalParamSettings />);

    expect(await screen.findByText('VOLCENGINE_TTS_API_KEY')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('****8838'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    expect(await screen.findByText('当前值：****8838')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('settings.params.valueEditPlaceholder'), {
      target: { value: 'new-secret-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: /OK|确 定|确定/ }));

    await waitFor(() => {
      expect(mockSavePersonalParam).toHaveBeenCalledWith(
        expect.objectContaining({
          paramId: 10001,
          key: 'VOLCENGINE_TTS_API_KEY',
          value: 'new-secret-value',
          description: 'TTS key',
          enabled: true,
        })
      );
    });
  });
});
