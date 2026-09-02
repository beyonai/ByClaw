import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import PersonalParamSettings from '..';
import { queryPersonalParams, savePersonalParam } from '@/service/personalParam';

jest.setTimeout(90000);

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) => {
      if (id === 'settings.params.valueMaskedTip') {
        return `Current value: ${values?.value}`;
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

    await waitFor(() => {
      expect(mockQueryPersonalParams).toHaveBeenCalled();
    });
    expect(await screen.findByText('VOLCENGINE_TTS_API_KEY', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('****8838'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    expect(await screen.findByText('Current value: ****8838')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('settings.params.valueEditPlaceholder'), {
      target: { value: 'new-secret-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

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

  it('marks connector environment parameters as managed and hides user operations', async () => {
    mockQueryPersonalParams.mockResolvedValueOnce({
      list: [
        {
          paramId: 10002,
          key: 'LARK_HOME',
          description: 'Lark CLI home',
          status: 'NORMAL',
          enabled: true,
          hasValue: true,
          valueLast4: 'TAIL',
          source: 'CONNECTOR',
          sourceRef: 'lark',
          managed: true,
          editable: false,
          deletable: false,
          enableable: false,
        },
      ],
      total: 1,
      pageNum: 1,
      pageSize: 10,
    });

    render(<PersonalParamSettings />);

    const key = await screen.findByText('LARK_HOME');
    expect(screen.getAllByText('settings.params.source')).not.toHaveLength(0);
    const row = key.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText('settings.params.source.connector')).toBeInTheDocument();
    expect(within(row as HTMLTableRowElement).getByText(/settings.params.configured/)).toBeInTheDocument();
    expect(within(row as HTMLTableRowElement).queryByText(/TAIL/)).not.toBeInTheDocument();
    const cells = within(row as HTMLTableRowElement).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('-');
    expect(within(row as HTMLTableRowElement).queryByRole('button')).not.toBeInTheDocument();
  });
});
