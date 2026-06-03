import { buildFormFieldName, buildFormItemPath, mergeTermOptions, normalizeTermOptions } from './utils';

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
});
