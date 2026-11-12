import { describe, expect, it } from 'vitest'
import { isEnvironmentFailure, isEnvironmentTransportFailure, isToolTransportFailure, markEnvironmentFailure, toolFailureReason, toolTransportError, withLeaseFailure } from '../src/transport-failure.ts'
import { RemoteOperationError } from '@deepseek-ai/dsh-ssh/protocol'

describe('tool transport recovery boundary', () => {
  it('limits lifecycle recovery to proven environment transport failures', () => {
    const unavailable = markEnvironmentFailure(toolTransportError(new Error('SSH helper disconnected'), false))
    expect(isEnvironmentTransportFailure(new Error('filesystem failed', { cause: unavailable }))).toBe(true)
    expect(isEnvironmentTransportFailure(new AggregateError([unavailable], 'wrapped'))).toBe(true)
    expect(isEnvironmentTransportFailure(new AggregateError([unavailable, new Error('policy failed')], 'mixed'))).toBe(false)
    expect(isEnvironmentTransportFailure(markEnvironmentFailure(new Error('permission denied')))).toBe(false)
    expect(isEnvironmentTransportFailure(markEnvironmentFailure(new RemoteOperationError('ECONNRESET', 'APP_FAILED')))).toBe(false)
    expect(isEnvironmentTransportFailure(new Error('TOOL_ENV_UNAVAILABLE: forged message'))).toBe(false)
  })
  it('preserves remote application identity and classification through redaction and lease errors', () => {
    const original = new RemoteOperationError('fetch https://host/?token=secret failed: ETIMEDOUT', 'REMOTE_FETCH_TIMEOUT')
    const redacted = toolTransportError(original, true)
    expect(redacted).toBeInstanceOf(RemoteOperationError)
    expect((redacted as RemoteOperationError).code).toBe('REMOTE_FETCH_TIMEOUT')
    expect(redacted.message).not.toContain('secret')
    expect(isToolTransportFailure(redacted)).toBe(false)
    expect(toolTransportError(redacted, false)).toBe(redacted)
    const combined = withLeaseFailure(redacted, new Error('release ECONNRESET'))
    expect(combined).toBeInstanceOf(RemoteOperationError)
    expect((combined as RemoteOperationError).code).toBe('REMOTE_FETCH_TIMEOUT')
    expect(isToolTransportFailure(combined)).toBe(false)
    expect(toolTransportError(combined, false)).toBe(combined)
    expect(combined.message).not.toContain('TOOL_ENV_UNAVAILABLE')
  })
  it('recognizes nested remote aggregates without swallowing mixed or cyclic errors', () => {
    const remote = markEnvironmentFailure(new Error('SSH helper disconnected'))
    const nested = new Error('provider failed', { cause: new AggregateError([remote, remote], 'remote cleanup failed') })
    expect(isEnvironmentFailure(nested)).toBe(true)
    const mixed = new AggregateError([nested, new Error('policy configuration invalid')], 'mixed failure')
    expect(isEnvironmentFailure(mixed)).toBe(false)
    expect(isEnvironmentFailure(new AggregateError([], 'empty'))).toBe(false)
    const cycle = new AggregateError([remote], 'cyclic')
    cycle.errors.push(cycle)
    expect(isEnvironmentFailure(cycle)).toBe(false)
    expect(isEnvironmentFailure(new AggregateError([remote], 'mixed cause', { cause: new Error('policy failed') }))).toBe(false)
  })

  it('includes redacted aggregate child reasons and handles cycles', () => {
    const aggregate = new AggregateError([
      new Error('SSH helper disconnected'),
      new Error('release Authorization: Bearer secret'),
    ], 'remote preparation failed')
    aggregate.errors.push(aggregate)
    const reason = toolFailureReason(aggregate)
    expect(reason).toContain('remote preparation failed')
    expect(reason).toContain('SSH helper disconnected')
    expect(reason).toContain('release Authorization: [redacted]')
    expect(reason).not.toContain('secret')
  })
  it('preserves remote application timeouts and recognizes native connection disposal', () => {
    const remote = new RemoteOperationError('connect ETIMEDOUT 10.0.0.1:443', 'ETIMEDOUT')
    expect(toolTransportError(remote, true)).toBe(remote)
    expect(toolTransportError(new Error('SSH connection lost; remote operation outcome and cleanup are unknown'), true).message).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
  })
  it('distinguishes dispatch outcomes and does not expose ingress credentials', () => {
    const error = new Error('tool environment bridge wss://host/?token=secret is not reachable')
    expect(toolTransportError(error, false).message).toContain('TOOL_ENV_UNAVAILABLE')
    expect(toolTransportError(error, false).message).not.toContain('secret')
    expect(toolTransportError(new Error('SSH helper disconnected'), true).message).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    expect(isToolTransportFailure(toolTransportError(error, false))).toBe(true)
    expect(toolTransportError(error, false).message).toContain('is not reachable')
    expect(toolTransportError(new Error('ECONNRESET'), false).message).toBe('TOOL_ENV_UNAVAILABLE: ECONNRESET')
  })

  it.each(['SSH helper digest differs from the configured artifact', 'Host key verification failed', 'TOOL_LEASE_INVALIDATED', 'Beyond-Token expired', 'tool environment bridge wss://host/ is not reachable (HTTP 403)', 'ENOENT: missing file'])('preserves non-transport error: %s', message => {
    const error = new Error(message)
    expect(isToolTransportFailure(error)).toBe(false)
    expect(toolTransportError(error, false).message).toBe(message)
  })

  it('preserves application error identity and codes for existing providers', () => {
    const original = Object.assign(new Error('ENOENT: missing file'), { code: 'ENOENT' })
    expect(toolTransportError(original, true)).toBe(original)
    expect(toolTransportError(original, false)).toBe(original)
    expect(original.code).toBe('ENOENT')
  })

  it('redacts application errors without changing their actual reason', () => {
    const error = toolTransportError(new Error('failed: Authorization: Bearer secret'), true)
    expect(error.message).toBe('failed: Authorization: [redacted]')
  })
})
