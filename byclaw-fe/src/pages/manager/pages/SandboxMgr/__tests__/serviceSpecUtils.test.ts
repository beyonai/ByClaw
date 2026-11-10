import {
  buildServiceSpecPayload,
  formatJsonIfValid,
  isServiceSpecAutoStartEnabled,
  getServiceSpecDimension,
  buildServiceSpecEnabledPayload,
  isServiceSpecEnabled,
  normalizeCapabilities,
  isValidToolCover,
  MAX_TOOL_COVER_BYTES,
  buildToolSandboxPayload,
  getToolSandboxMetadata,
} from '../serviceSpecUtils';

describe('serviceSpecUtils', () => {
  it('reads login startup from lifecycle independently of template enablement', () => {
    expect(isServiceSpecAutoStartEnabled({ serviceKey: 'legacy', specJson: '{}' })).toBe(true);
    expect(
      isServiceSpecAutoStartEnabled({
        serviceKey: 'browser',
        enabled: 1,
        specJson: '{"runtimeOptions":{"lifecycle":{"autoStart":"false"}}}',
      })
    ).toBe(false);
  });

  it('disables login startup while preserving on-demand execution and unrelated options', () => {
    const payload = buildServiceSpecPayload(
      {
        serviceKey: 'byclaw-tools-browser',
        enabled: 1,
        specJson: '{"image":"browser","runtimeOptions":{"lifecycle":{"keep":"yes"},"toolSandbox":{"contract":"v1"}}}',
        templateJson: '{"env":{}}',
      },
      false
    );
    expect(payload.enabled).toBe(1);
    expect(payload.templateJson).toBe('{"env":{}}');
    expect(JSON.parse(payload.specJson)).toEqual({
      image: 'browser',
      runtimeOptions: { lifecycle: { keep: 'yes', autoStart: 'false' }, toolSandbox: { contract: 'v1' } },
    });
  });

  it('preserves a disabled template when enabling login startup', () => {
    const payload = buildServiceSpecPayload({ serviceKey: 'disabled', specJson: '{}', enabled: 0 }, true);
    expect(payload.enabled).toBe(0);
    expect(JSON.parse(payload.specJson).runtimeOptions.lifecycle.autoStart).toBe('true');
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

describe('four-dimensional service specifications', () => {
  const spec = (extra = {}) => ({ serviceKey: 'arbitrary-name', specJson: '{}', ...extra });

  it('classifies by the exact tool contract before explicit ownership without guessing names', () => {
    expect(getServiceSpecDimension(spec({ ownerScope: 'TENANT' }))).toBe('TENANT');
    expect(getServiceSpecDimension(spec({ ownerScope: 'SHARED' }))).toBe('SHARED');
    expect(getServiceSpecDimension(spec({ serviceKey: 'shared-browser-tools' }))).toBe('USER');
    expect(
      getServiceSpecDimension(
        spec({
          ownerScope: 'SHARED',
          specJson: JSON.stringify({
            runtimeOptions: { toolSandbox: { contract: 'byclaw.tool-sandbox/v1' } },
          }),
        })
      )
    ).toBe('TOOL');
    expect(getServiceSpecDimension(spec({ specJson: '{bad' }))).toBe('USER');
  });

  it('changes tool availability independently of login startup and preserves the complete spec', () => {
    const original = spec({
      ownerScope: 'TENANT',
      displayName: 'Browser',
      serviceType: 'tools',
      templateJson: '{"env":{}}',
      enabled: 1,
      specJson: JSON.stringify({
        image: 'browser',
        runtimeOptions: {
          lifecycle: { autoStart: 'true', keep: 'yes' },
          toolSandbox: { contract: 'byclaw.tool-sandbox/v1', custom: 'preserved', capabilities: '["browse"]' },
        },
      }),
    });
    const payload = buildServiceSpecEnabledPayload(original, false);
    expect(payload).toEqual(
      expect.objectContaining({
        ownerScope: 'TENANT',
        displayName: 'Browser',
        serviceType: 'tools',
        enabled: 0,
        templateJson: '{"env":{}}',
      })
    );
    const config = JSON.parse(payload.specJson);
    expect(config.runtimeOptions.lifecycle).toEqual({ autoStart: 'true', keep: 'yes' });
    expect(config.runtimeOptions.toolSandbox).toEqual({
      contract: 'byclaw.tool-sandbox/v1',
      custom: 'preserved',
      capabilities: '["browse"]',
      enabled: 'false',
    });
    expect(isServiceSpecEnabled(payload)).toBe(false);
    expect(isServiceSpecEnabled(buildServiceSpecEnabledPayload(payload, true))).toBe(true);
    expect(
      isServiceSpecEnabled(
        spec({
          enabled: 1,
          specJson: JSON.stringify({
            runtimeOptions: { toolSandbox: { contract: 'byclaw.tool-sandbox/v1', enabled: false } },
          }),
        })
      )
    ).toBe(false);
  });

  it('normalizes old string and array capability metadata and bounds image uploads', () => {
    expect(normalizeCapabilities('browse, video\nbrowse')).toEqual(['browse', 'video']);
    expect(normalizeCapabilities('["browse","media"]')).toEqual(['browse', 'media']);
    expect(normalizeCapabilities(['browse', '', ' browse ', 4])).toEqual(['browse']);
    expect(isValidToolCover('https://example.com/image.png')).toBe(true);
    expect(isValidToolCover('data:image/png;base64,aGVsbG8=')).toBe(true);
    expect(isValidToolCover(`data:image/png;base64,${Buffer.alloc(MAX_TOOL_COVER_BYTES).toString('base64')}`)).toBe(
      true
    );
    expect(isValidToolCover(`data:image/png;base64,${Buffer.alloc(MAX_TOOL_COVER_BYTES + 1).toString('base64')}`)).toBe(
      false
    );
    expect(isValidToolCover('data:image/png;base64,a')).toBe(false);
    expect(isValidToolCover('javascript:alert(1)')).toBe(false);
    expect(isValidToolCover('data:image/svg+xml;base64,AAA=')).toBe(false);
    expect(isValidToolCover(`data:image/png;base64,${'a'.repeat(MAX_TOOL_COVER_BYTES * 2)}`)).toBe(false);
  });

  it('accepts same-origin cover paths and rejects unsupported media formats', () => {
    expect(isValidToolCover('/assets/browser.png')).toBe(true);
    expect(isValidToolCover('//external.example/cover.png')).toBe(false);
    expect(isValidToolCover('data:image/gif;base64,aGVsbG8=')).toBe(false);
  });

  it('saves market fields as platform-compatible strings without losing runtime configuration', () => {
    const payload = buildToolSandboxPayload(
      spec({
        enabled: 1,
        specJson:
          '{"image":"kept","runtimeOptions":{"lifecycle":{"autoStart":"false"},"toolSandbox":{"custom":"kept"}}}',
      }),
      {
        description: 'Browser workspace',
        capabilities: ['browser', ' browser ', 'automation'],
        coverImage: 'https://example.com/cover.png',
        enabled: true,
      }
    );
    const config = JSON.parse(payload.specJson);
    expect(config.image).toBe('kept');
    expect(config.runtimeOptions.lifecycle.autoStart).toBe('false');
    expect(config.runtimeOptions.toolSandbox).toEqual({
      custom: 'kept',
      contract: 'byclaw.tool-sandbox/v1',
      description: 'Browser workspace',
      capabilities: '["browser","automation"]',
      coverImage: 'https://example.com/cover.png',
      enabled: 'true',
    });
    expect(getToolSandboxMetadata(payload).capabilities).toEqual(['browser', 'automation']);
  });
});
