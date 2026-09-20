import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import EmployeeList from '..';

const mockSearch = jest.fn();
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useLocation: () => ({ pathname: '/chat' }),
  useNavigate: () => jest.fn(),
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('../components/FrequentEmployess', () => () => null);
jest.mock('../components/LateEmployess', () => () => null);
jest.mock('../components/AllEmployees', () => {
  const React = jest.requireActual('react');
  return React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ getSearch: mockSearch }));
    return <div data-testid="employee-list">Employee result</div>;
  });
});

describe('compact employee picker layout', () => {
  beforeEach(() => mockSearch.mockClear());

  it('places the employee list directly inside the remaining-height container', () => {
    render(<EmployeeList hideCategoryTabs compactCard />);
    // 搜索栏下方不再经过隐藏 Tabs 包装，列表能直接获得父级 flex 分配的高度。
    expect(screen.getByTestId('employee-list').parentElement?.id).toBe('guideStep2-3');
    expect(screen.getByText('Employee result')).toBeTruthy();
  });

  it('keeps the search ref wired to the directly rendered employee list', () => {
    render(<EmployeeList hideCategoryTabs compactCard />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(mockSearch).toHaveBeenCalledWith('Alice');
  });
});
