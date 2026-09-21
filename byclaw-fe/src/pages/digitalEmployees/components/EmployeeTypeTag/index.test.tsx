import React from 'react';
import { render, screen } from '@testing-library/react';
import EmployeeTypeTag from '.';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

// 弹窗与卡片共用类型文案和颜色，默认个人员工也必须识别为个人类型。
describe('employee preview type tag', () => {
  it.each([
    ['personal', '001', 'personalEmployee', 'digitalEmployeePersonalTag'],
    ['personal', '017', 'personalGroup', 'digitalEmployeePersonalTag'],
    ['personal_default', '001', 'personalEmployee', 'digitalEmployeePersonalTag'],
    ['personal_default', '017', 'personalGroup', 'digitalEmployeePersonalTag'],
    ['enterprise', '001', 'enterpriseEmployee', 'digitalEmployeeEnterpriseTag'],
    ['enterprise', '017', 'enterpriseGroup', 'digitalEmployeeEnterpriseTag'],
  ])('matches card labels for %s / %s', (ownerType, agentType, label, style) => {
    render(<EmployeeTypeTag ownerType={ownerType} agentType={agentType} />);

    const text = screen.getByText(`digitalEmployees.tag.${label}`);
    expect(text).toHaveClass('tagText');
    expect(text.parentElement).toHaveClass('tag', style);
    expect(text.parentElement).not.toHaveClass('digitalEmployeeTopRightTag');
  });
});
