import { describe, expect, it } from 'vitest'
import { scrubEnvironment } from '../src/connection.ts'

describe('scrubEnvironment', () => {
  it('drops tool-environment settings from forwarded process environments', () => {
    const params = { argv: ['/bin/sh'], env: {
      PATH: '/usr/bin', BYCLAW_DSH_TOOL_ENV: 'opensandbox', BYCLAW_TOOL_ENV_OPENSANDBOX: '{"apiKey":"secret"}',
      BYCLAW_TOOL_ENV_IDLE_MS: '1', BYCLAW_DSH_TOOL_ENVIRONMENT_NOTE: 'kept', HOME: null,
    } }
    expect(scrubEnvironment(params)).toEqual({ argv: ['/bin/sh'], env: { PATH: '/usr/bin', BYCLAW_DSH_TOOL_ENVIRONMENT_NOTE: 'kept', HOME: null } })
    expect(params.env.BYCLAW_TOOL_ENV_OPENSANDBOX).toBe('{"apiKey":"secret"}')
  })

  it('leaves requests without an environment untouched', () => {
    const params = { target: { targetKey: '/by/a' } }
    expect(scrubEnvironment(params)).toBe(params)
    expect(scrubEnvironment(undefined)).toBeUndefined()
    expect(scrubEnvironment({ env: undefined })).toEqual({ env: undefined })
  })
})
