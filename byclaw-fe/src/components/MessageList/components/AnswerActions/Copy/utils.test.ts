import { getQuestionCopyText } from './utils';

describe('getQuestionCopyText', () => {
  it('removes digital employee and legacy assistant mentions', () => {
    expect(getQuestionCopyText('{{DIG_EMPLOYEE_102}} {{HUMAN_ASSISTANT_1}} 你好')).toBe('你好');
  });

  it('removes resource references and employee skill references without resource details', () => {
    expect(
      getQuestionCopyText('{{KG_DOC_FILE_1}}总结{{COMMON_FILE_2}}\n{{DIG_EMPLOYEE_102#SKILL_3}}生成报告')
    ).toBe('总结\n生成报告');
  });

  it('preserves literal mentions, template text, markdown and internal whitespace', () => {
    const text = '联系 a@example.com 或 @同事\n{{name}} **正文**  内容';
    expect(getQuestionCopyText(text)).toBe(text);
  });

  it('returns no text for empty messages or messages containing only resources', () => {
    expect(getQuestionCopyText('')).toBe('');
    expect(getQuestionCopyText('{{DIG_EMPLOYEE_102}} {{KG_DOC_1}}')).toBe('');
  });
});
