/** File-backed settings with an environment default for busy Enter delivery. */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import { FileSettingsProvider, type Config } from '@deepseek-ai/dsh-settings-file'
import type { SettingsRegisterOptions, SettingsScope } from '@deepseek-ai/dsh-settings'

/** Preserve file settings and user overrides while supplying the conversation default. */
export default class ByClawSettingsProvider extends FileSettingsProvider {
  private readonly busyEnter: 'queue' | 'steer'

  /**
   * @param ctx - Host context providing settings to the profile.
   * @param config - the shipped file provider's location and watcher configuration.
   * @throws when BYCLAW_DSH_BUSY_ENTER is set to anything except queue or steer.
   */
  constructor(ctx: Context, config: Config) {
    const busyEnter = process.env['BYCLAW_DSH_BUSY_ENTER'] ?? 'queue'
    if (busyEnter !== 'queue' && busyEnter !== 'steer') {
      throw new Error('BYCLAW_DSH_BUSY_ENTER must be queue or steer')
    }
    super(ctx, config)
    this.busyEnter = busyEnter
  }

  /**
   * Supply the busy-Enter default beneath the stored user preference.
   * @param ns - namespace registered by its owning plugin.
   * @param schema - the owner's schema, including validation and defaults.
   * @param options - the owner's remaining composition values and validation.
   * @returns the file provider's live settings scope.
   */
  override register<const Namespace extends string, T>(
    ns: Namespace,
    schema: z<T>,
    options?: SettingsRegisterOptions<T>,
  ): SettingsScope<T> {
    if (ns !== 'ui-conversation') return super.register<string, T>(ns, schema, options)
    const base = Object.assign({}, options?.base, { busyEnter: this.busyEnter })
    return super.register<string, T>(ns, schema, { ...options, base })
  }
}
