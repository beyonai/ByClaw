import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TreeFilter from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('antd', () => {
  const React = require('react');

  return {
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Dropdown: ({ children }: any) => React.createElement(React.Fragment, null, children),
  };
});

const treeData = [
  { label: '启用', key: 'ENABLED', keypath: 'ENABLED' },
  { label: '停用', key: 'DISABLED', keypath: 'DISABLED' },
];

describe('TreeFilter', () => {
  it('uses the latest onOk callback after a parent filter update', () => {
    const firstOnOk = jest.fn();
    const latestOnOk = jest.fn();
    const { rerender } = render(<TreeFilter title="状态" treeData={treeData} selectedList={[]} onOk={firstOnOk} />);

    fireEvent.click(screen.getByText('启用'));
    expect(firstOnOk).toHaveBeenCalledWith([treeData[0]]);

    rerender(<TreeFilter title="状态" treeData={treeData} selectedList={[]} onOk={latestOnOk} />);
    fireEvent.click(screen.getByText('停用'));

    expect(latestOnOk).toHaveBeenCalledWith([treeData[1]]);
    expect(firstOnOk).toHaveBeenCalledTimes(1);
  });
});
