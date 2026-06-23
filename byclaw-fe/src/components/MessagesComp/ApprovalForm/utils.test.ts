import dayjs from 'dayjs';

import {
  buildFormFieldName,
  buildFormItemPath,
  getApprovalFormDateFormat,
  getApprovalFormDatePickerValue,
  getApprovalFormDateSubmitValue,
  mergeTermOptions,
  normalizeTermOptions,
} from './utils';

describe('ApprovalForm utils', () => {
  it('builds root form item path', () => {
    expect(buildFormItemPath(0, 1)).toBe('0.1');
  });

  it('builds nested array child form item path', () => {
    expect(buildFormItemPath(0, 1, '2.3')).toBe('2.3.children.0.1');
  });

  it('builds field name with path so onValuesChange can locate the target item', () => {
    expect(buildFormFieldName('childCode', '2.3.children.0.1')).toBe('childCode|2.3.children.0.1');
  });

  it('normalizes term options from array responses', () => {
    expect(
      normalizeTermOptions([
        { label: 'Revenue', value: 'revenue' },
        { name: 'Cost', code: 12 },
      ])
    ).toEqual([
      { label: 'Revenue', value: 'revenue' },
      { label: 'Cost', value: 12 },
    ]);
  });

  it('normalizes term options from paged list responses', () => {
    expect(normalizeTermOptions({ list: [{ name: 'Gross Margin', code: 'gm' }] })).toEqual([
      { label: 'Gross Margin', value: 'gm' },
    ]);
  });

  it('normalizes term options from getTermsOptions item responses', () => {
    expect(
      normalizeTermOptions({
        items: [
          {
            label: '国投中债-BI-实施项目',
            value: 'PROJ00000001',
            code: 'PROJ00000001',
            name: '国投中债-BI-实施项目',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 151,
      })
    ).toEqual([{ label: '国投中债-BI-实施项目', value: 'PROJ00000001' }]);
  });

  it('merges paged term options by value', () => {
    expect(
      mergeTermOptions(
        [
          { label: '项目1', value: 'PROJ00000001' },
          { label: '项目2', value: 'PROJ00000002' },
        ],
        [
          { label: '项目2 - updated', value: 'PROJ00000002' },
          { label: '项目3', value: 'PROJ00000003' },
        ]
      )
    ).toEqual([
      { label: '项目1', value: 'PROJ00000001' },
      { label: '项目2 - updated', value: 'PROJ00000002' },
      { label: '项目3', value: 'PROJ00000003' },
    ]);
  });

  it('formats date picker values as submit strings with the field format', () => {
    const format = getApprovalFormDateFormat('yyyy-MM-dd HH:mm:ss');

    expect(format).toBe('YYYY-MM-DD HH:mm:ss');
    expect(getApprovalFormDateSubmitValue(dayjs('2026-06-23 14:05:06'), format)).toBe('2026-06-23 14:05:06');
    expect(getApprovalFormDateSubmitValue(undefined, format)).toBeUndefined();
  });

  it('converts date submit strings back to date picker values', () => {
    const value = getApprovalFormDatePickerValue('2026-06-23', 'YYYY-MM-DD');

    expect(dayjs.isDayjs(value)).toBe(true);
    expect(value?.format('YYYY-MM-DD')).toBe('2026-06-23');
    expect(getApprovalFormDatePickerValue('invalid-date', 'YYYY-MM-DD')).toBeUndefined();
  });
});
