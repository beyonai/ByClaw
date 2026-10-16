import { fireEvent, render, screen, within } from '@testing-library/react';
import ModelFilterPanel from '../ModelFilterPanel';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('model dropdown filters', () => {
  it.each(['ModelType', 'Status', 'Ability', 'System'] as const)('selects and clears %s independently', async (dimension) => {
    const options = [
      { key: 'first', keypath: 'first', label: 'First' },
      { key: 'second', keypath: 'second', label: 'Second' },
      { key: 'third', keypath: 'third', label: 'Third' },
      { key: 'fourth', keypath: 'fourth', label: 'Fourth' },
    ];
    const props = {
      intl: { formatMessage: ({ id }: { id: string }) => id },
      modelTypeTreeData: options,
      modelTypeSelectedList: [],
      onModelTypeOk: jest.fn(),
      statusTreeData: options,
      abilityTreeData: options,
      systemTreeData: options,
      statusSelectedList: [],
      abilitySelectedList: [],
      systemSelectedList: [],
      onStatusOk: jest.fn(),
      onAbilityOk: jest.fn(),
      onSystemOk: jest.fn(),
    };
    const { rerender } = render(<ModelFilterPanel {...props} />);
    const group = within(screen.getByRole('group', { name: `modelMgr.filter${dimension}` }));
    expect(screen.getAllByRole('group').map((item) => item.getAttribute('aria-label'))).toEqual([
      'modelMgr.filterModelType',
      'modelMgr.filterAbility',
      'modelMgr.filterStatus',
      'modelMgr.filterSystem',
    ]);
    // 第四项只在旧版浮窗中出现，悬停后可以选择。
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument();
    fireEvent.mouseEnter(group.getByText(`modelMgr.filter${dimension}`).parentElement!);
    fireEvent.click(await screen.findByText('Fourth'));
    expect(props[`on${dimension}Ok`]).toHaveBeenCalledTimes(1);
    expect(props[`on${dimension}Ok`]).toHaveBeenLastCalledWith([options[3]]);
    for (const other of ['ModelType', 'Status', 'Ability', 'System'] as const) {
      if (other !== dimension) expect(props[`on${other}Ok`]).not.toHaveBeenCalled();
    }

    const selectedProp = dimension === 'ModelType' ? 'modelTypeSelectedList' : `${dimension.toLowerCase()}SelectedList`;
    rerender(<ModelFilterPanel {...props} {...{ [selectedProp]: [options[3]] }} />);
    expect(group.getByText('Fourth')).toBeInTheDocument();
    fireEvent.click(group.getByRole('img', { name: 'close-circle' }));
    expect(props[`on${dimension}Ok`]).toHaveBeenLastCalledWith([]);
    rerender(<ModelFilterPanel {...props} />);
    expect(group.getAllByText('First').find((item) => !item.closest('[aria-hidden="true"]'))).toBeVisible();
  });
});
