import presets from './builtinToolSandboxPresets.json';
import {
  buildServiceSpecPayload,
  buildToolSandboxPayload,
  isServiceSpecEnabled,
  type ServiceSpecConfig,
} from './serviceSpecUtils';

/** Suggested fixed compute sizes; applying presentation does not resize an existing resource profile. */
export const BUILTIN_TOOL_SANDBOX_PRESETS = presets;

export const applyBuiltinToolSandboxPreset = <T extends ServiceSpecConfig>(spec: T, publicPath: string): T => {
  const preset = presets.find((item) => item.serviceKey === spec.serviceKey || item.aliases.includes(spec.serviceKey));
  if (!preset) return spec;
  const base = publicPath.startsWith('/') && !publicPath.startsWith('//') ? publicPath : '/';
  const updated = buildToolSandboxPayload(buildServiceSpecPayload(spec, false), {
    description: preset.description,
    coverImage: `${base.endsWith('/') ? base : `${base}/`}${preset.coverImage}`,
    capabilities: preset.capabilities,
    enabled: isServiceSpecEnabled(spec),
  });
  const config = JSON.parse(updated.specJson);
  config.runtimeOptions.toolSandbox.purpose = preset.purpose;
  return { ...spec, ...updated, displayName: preset.displayName, specJson: JSON.stringify(config) };
};
