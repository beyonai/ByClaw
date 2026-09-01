import { buildServiceSpecPayload, isServiceSpecAutoStartEnabled } from '../serviceSpecUtils';

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
});
