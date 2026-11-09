import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyBuiltinToolSandboxPreset, BUILTIN_TOOL_SANDBOX_PRESETS } from '../toolSandboxPresets';
import { getServiceSpecDimension, isValidToolCover } from '../serviceSpecUtils';

describe('built-in tool sandbox maintenance presets', () => {
  test('admits the general execution sandbox without changing its image, startup, secrets or disabled state', () => {
    const source = {
      serviceKey: 'byclaw-dsh-tools',
      serviceType: 'existing-tool-type',
      ownerScope: 'USER',
      enabled: 0,
      specJson: JSON.stringify({
        image: 'keep-image',
        startup: { entrypoint: ['keep-entrypoint', 'tools'] },
        env: { PRIVATE_KEY: 'fixture' },
        runtimeOptions: { lifecycle: { custom: 'keep' } },
      }),
    };
    const updated = applyBuiltinToolSandboxPreset(source, '/beyond/');
    expect(getServiceSpecDimension(updated)).toBe('TOOL');
    expect(updated.serviceType).toBe('existing-tool-type');
    expect(updated.enabled).toBe(0);
    expect(JSON.parse(updated.specJson)).toEqual({
      image: 'keep-image',
      startup: { entrypoint: ['keep-entrypoint', 'tools'] },
      env: { PRIVATE_KEY: 'fixture' },
      runtimeOptions: {
        lifecycle: { custom: 'keep', autoStart: 'false' },
        toolSandbox: expect.objectContaining({
          contract: 'byclaw.tool-sandbox/v1',
          purpose: 'general',
          enabled: 'false',
          coverImage: '/beyond/tool-sandbox/covers/general.svg',
        }),
      },
    });
    expect(JSON.parse(updated.specJson).runtimeOptions.toolSandbox.description).toContain('用户级');
  });

  test('provides six distinct, self-contained covers and capabilities with workload-specific resource recommendations', () => {
    expect(BUILTIN_TOOL_SANDBOX_PRESETS).toHaveLength(6);
    expect(new Set(BUILTIN_TOOL_SANDBOX_PRESETS.map((preset) => preset.purpose)).size).toBe(6);
    for (const preset of BUILTIN_TOOL_SANDBOX_PRESETS) {
      const result = applyBuiltinToolSandboxPreset({ serviceKey: preset.serviceKey, specJson: '{}' }, '/');
      const metadata = JSON.parse(result.specJson).runtimeOptions.toolSandbox;
      expect(isValidToolCover(metadata.coverImage)).toBe(true);
      const cover = readFileSync(resolve(process.cwd(), 'public', preset.coverImage), 'utf8');
      expect(cover).toContain('<svg');
      expect(cover).not.toMatch(/<script|<foreignObject|(?:href|src)\s*=/);
      expect(JSON.parse(metadata.capabilities)).toContain('process.exec');
      expect(preset.resources.limits.cpu).toMatch(/^[1-9]\d*$/);
      expect(preset.resources.limits.memory).toMatch(/^[1-9]\d*Gi$/);
    }
    const limits = Object.fromEntries(
      BUILTIN_TOOL_SANDBOX_PRESETS.map((preset) => [preset.purpose, preset.resources.limits])
    );
    expect(limits.general).toEqual({ cpu: '2', memory: '4Gi' });
    expect(limits.browser).toEqual({ cpu: '2', memory: '2Gi' });
    expect(limits.media).toEqual({ cpu: '4', memory: '4Gi' });
    expect(limits.godot).toEqual({ cpu: '4', memory: '4Gi' });
    expect(limits.unity).toEqual({ cpu: '4', memory: '8Gi' });
    expect(limits['software-development']).toEqual({ cpu: '4', memory: '8Gi' });
  });

  test('does not guess unknown templates or overwrite their custom metadata', () => {
    const source = { serviceKey: 'my-custom-tool', specJson: '{"image":"custom"}' };
    expect(applyBuiltinToolSandboxPreset(source, '/')).toBe(source);
  });
});
