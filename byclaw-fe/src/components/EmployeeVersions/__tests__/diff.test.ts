import { comparisonRows, displayValue, changedText } from '../diff';

describe('employee version comparison', () => {
  it('compares object values and unordered resource bindings without false positives', () => {
    const rows = comparisonRows(
      { relTools: ['search', 'weather'], prologue: '{"modelInfo":{"modelId":"123","temperature":0.5}}' },
      { relTools: ['weather', 'search'], prologue: '{"modelInfo":{"temperature":0.5,"modelId":"123"}}' }
    );
    expect(rows.filter((row) => row.changed)).toHaveLength(0);
  });
  it('preserves order for employee group members and recognizes added/removed fields', () => {
    const a = { resourceId: '1', teamRole: 'writer' };
    const b = { resourceId: '2', teamRole: 'reviewer' };
    const rows = comparisonRows(
      { employeeGroupMembers: [a, b], resourceDesc: 'old' },
      { employeeGroupMembers: [b, a], resourceName: 'new' }
    );
    expect(rows.find((row) => row.key === 'employeeGroupMembers')?.kind).toBe('changed');
    expect(rows.find((row) => row.key === 'resourceDesc')?.kind).toBe('removed');
    expect(rows.find((row) => row.key === 'resourceName')?.kind).toBe('added');
  });
  it('does not coerce large model ids or render prompt HTML', () => {
    expect(displayValue('9007199254740993')).toBe('9007199254740993');
    expect(displayValue('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(changedText('你好旧提示词结束', '你好新提示词结束')).toEqual(['你好', '旧', '提示词结束']);
  });
  it('supports empty values and compares a version with itself', () => {
    expect(displayValue(null)).toBe('未设置');
    expect(displayValue([])).toBe('[]');
    expect(comparisonRows({ resourceName: 'A' }, { resourceName: 'A' }).some((row) => row.changed)).toBe(false);
  });
});
