import { buildToolSandboxOptions, parseAdvancedSettings, readToolSandbox, writeToolSandbox } from './toolSandboxUtils';

describe('toolSandboxUtils', () => {
  it('reads the selection from the advanced settings entry and tolerates junk', () => {
    expect(readToolSandbox('[{"key":"toolSandbox","value":" byclaw-dsh-tools-media "}]')).toBe('byclaw-dsh-tools-media');
    expect(readToolSandbox([{ key: 'other', value: 'x' }])).toBeUndefined();
    expect(readToolSandbox('[{"key":"toolSandbox","value":""}]')).toBeUndefined();
    expect(readToolSandbox('{not json')).toBeUndefined();
    expect(readToolSandbox(undefined)).toBeUndefined();
    expect(parseAdvancedSettings('{"a":1}')).toEqual([]);
  });

  it('writes the selection as one entry and keeps the others; clearing removes it', () => {
    const existing = [{ key: 'other', value: 'x' }, { key: 'toolSandbox', value: 'old' }];
    expect(writeToolSandbox(existing, 'byclaw-dsh-tools-media')).toEqual([
      { key: 'other', value: 'x' },
      { key: 'toolSandbox', value: 'byclaw-dsh-tools-media' },
    ]);
    expect(writeToolSandbox(existing, undefined)).toEqual([{ key: 'other', value: 'x' }]);
    expect(writeToolSandbox('[]', ' ')).toEqual([]);
  });

  it('offers only specs that are not open for login, labelled by display name', () => {
    expect(
      buildToolSandboxOptions([
        { serviceKey: 'byclaw-dsh', displayName: 'DSH', enabled: 1 },
        { serviceKey: 'byclaw-dsh-tools', displayName: '工具沙箱', enabled: '0' },
        { serviceKey: 'byclaw-dsh-tools-media', displayName: '', enabled: 0 },
        { serviceKey: '', enabled: 0 },
        { serviceKey: 'openclaw', enabled: 'true' },
      ]),
    ).toEqual([
      { value: 'byclaw-dsh-tools', label: '工具沙箱' },
      { value: 'byclaw-dsh-tools-media', label: 'byclaw-dsh-tools-media' },
    ]);
  });
});
