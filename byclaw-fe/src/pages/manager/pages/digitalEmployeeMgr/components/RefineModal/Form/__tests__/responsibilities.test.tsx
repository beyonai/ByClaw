import { useState } from 'react';
import { Form } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import MyForm from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/pages/manager/components/AntdIcon', () => ({ type, onClick }: any) => (
  <button type="button" aria-label={type} onClick={onClick} />
));

const existingResponsibility = {
  id: 'existing',
  name: '制定教学计划',
  description: '保留生成的详细说明',
  acceptBoundary: ['课程安排'],
  rejectBoundary: ['财务审批'],
  example: ['安排本周课程'],
};

function Harness({ initial = [] }: { initial?: any[] }) {
  const [form] = Form.useForm();
  const [coreAbilities, setCoreAbilities] = useState(initial);
  const [selectedSections, setSelectedSections] = useState(new Set(['abilities']));
  return (
    <>
      <MyForm
        form={form}
        questionList={[]}
        setQuestionList={jest.fn()}
        tagsOptions={[]}
        setTagsOptions={jest.fn()}
        coreAbilities={coreAbilities}
        setCoreAbilities={setCoreAbilities}
        selectedSections={selectedSections}
        setSelectedSections={setSelectedSections}
      />
      <output data-testid="responsibilities">{JSON.stringify(coreAbilities)}</output>
    </>
  );
}

describe('refinement job responsibilities', () => {
  it('adds single-line responsibilities and allows deleting the last row like the detail form', () => {
    const { container } = render(<Harness />);
    const add = screen.getByRole('button', { name: '+ refineModal.add' });
    fireEvent.click(add);
    const input = screen.getByPlaceholderText('employeeDetail.abilityNamePlaceholder');
    expect(input.tagName).toBe('INPUT');
    expect(container.querySelector('.ant-collapse')).toBeNull();
    expect(screen.queryByPlaceholderText('refineModal.abilityDescPlaceholder')).toBeNull();

    fireEvent.change(input, { target: { value: '制定教学计划' } });
    fireEvent.click(add);
    expect(screen.getAllByPlaceholderText('employeeDetail.abilityNamePlaceholder')).toHaveLength(2);
    expect(screen.getByDisplayValue('制定教学计划')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'icon-a-Deleteshanchu' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'icon-a-Deleteshanchu' }));
    expect(screen.queryByPlaceholderText('employeeDetail.abilityNamePlaceholder')).toBeNull();
    expect(screen.getByTestId('responsibilities')).toHaveTextContent('[]');

    fireEvent.click(add);
    expect(screen.getByPlaceholderText('employeeDetail.abilityNamePlaceholder')).toHaveValue('');
  });

  // 精简展示不应丢弃生成结果中的描述、边界和示例，确保“使用”仍可完整回填。
  it('preserves generated metadata when editing the responsibility', () => {
    render(<Harness initial={[existingResponsibility]} />);
    fireEvent.change(screen.getByDisplayValue('制定教学计划'), { target: { value: '制定课程计划' } });
    expect(JSON.parse(screen.getByTestId('responsibilities').textContent || '[]')).toEqual([
      { ...existingResponsibility, name: '制定课程计划' },
    ]);
  });
});
