import { buildServiceSpecPayload, formatJsonIfValid, isServiceSpecAutoStartEnabled } from '../serviceSpecUtils';

describe('serviceSpecUtils', () => {
  it('treats missing historical enabled values as auto-start enabled', () => {
    expect(isServiceSpecAutoStartEnabled(undefined)).toBe(true);
    expect(isServiceSpecAutoStartEnabled(null)).toBe(true);
    expect(isServiceSpecAutoStartEnabled(1)).toBe(true);
    expect(isServiceSpecAutoStartEnabled(0)).toBe(false);
    expect(isServiceSpecAutoStartEnabled(false)).toBe(false);
  });

  it('builds a complete payload when toggling auto-start', () => {
    expect(
      buildServiceSpecPayload(
        {
          serviceKey: 'byclaw-dsh',
          specJson: '{"image":"dsh"}',
          templateJson: '{"env":{}}',
        },
        false
      )
    ).toEqual({
      serviceKey: 'byclaw-dsh',
      specJson: '{"image":"dsh"}',
      templateJson: '{"env":{}}',
      enabled: 0,
    });
  });

  it('formats valid JSON for the spec editor', () => {
    expect(formatJsonIfValid('{"image":"dsh","env":{"TZ":"Asia/Shanghai"}}')).toBe(
      '{\n  "image": "dsh",\n  "env": {\n    "TZ": "Asia/Shanghai"\n  }\n}'
    );
  });

  it('preserves invalid JSON so the user can correct it', () => {
    expect(formatJsonIfValid('{"image":')).toBe('{"image":');
  });
});
