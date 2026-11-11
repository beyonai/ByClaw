import { describe, expect, it } from 'vitest'
import { deploymentConfigured, deploymentEnvironment, isDeploymentParameter, loadDeploymentCredentials } from '../src/deployment-environment.ts'
import { ToolSandboxManager } from '../src/catalog.ts'

describe('deployment credential delivery', () => {
  it('loads live user credentials even when cloud startup environment has no deployment fields', async () => {
    let current: Record<string, string> = { BYCLAW_DEPLOY_HOST: 'example.invalid', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-current-user' }
    const references: string[] = []
    const resolve = async (name: string) => { references.push(name); return current[name] === undefined ? undefined : { value: current[name] } }
    const first = await loadDeploymentCredentials(resolve)
    expect(deploymentConfigured(first)).toBe(true)
    expect(first.BYCLAW_DEPLOY_PRIVATE_KEY).toBe('synthetic-current-user')
    expect(references).toHaveLength(7)
    current = { ...current, BYCLAW_DEPLOY_ENABLED: '0' }
    expect(deploymentConfigured(await loadDeploymentCredentials(resolve))).toBe(false)
    current = {}
    expect(deploymentConfigured(await loadDeploymentCredentials(resolve))).toBe(false)
  })
  it('accepts an enabled target/key pair, respects explicit pauses and forwards only connection fields', () => {
    for (const value of [undefined, '', '0', 'true']) {
      expect(() => deploymentEnvironment(value === undefined ? {} : { BYCLAW_DEPLOY_ENABLED: value })).toThrow('DEPLOYMENT_NOT_ENABLED')
    }
    const source = { BYCLAW_DEPLOY_ENABLED: '1', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private',
      BYCLAW_DEPLOY_CONTEXT: '/forged/context', BEYOND_TOKEN: 'not-a-deploy-secret' }
    expect(deploymentEnvironment(source)).toEqual({ BYCLAW_DEPLOY_ENABLED: '1', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private' })
    expect(isDeploymentParameter('BYCLAW_DEPLOY_CONTEXT')).toBe(true)
    expect(isDeploymentParameter('CODEX_AUTH')).toBe(false)
    expect(deploymentEnvironment({ BYCLAW_DEPLOY_HOST: 'example.invalid', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private' }))
      .toEqual({ BYCLAW_DEPLOY_HOST: 'example.invalid', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private', BYCLAW_DEPLOY_ENABLED: '1' })
    expect(() => deploymentEnvironment({ BYCLAW_DEPLOY_HOST: 'example.invalid' })).toThrow('DEPLOYMENT_NOT_ENABLED')
    expect(() => deploymentEnvironment({ BYCLAW_DEPLOY_HOST: 'example.invalid', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private', BYCLAW_DEPLOY_ENABLED: '0' })).toThrow('DEPLOYMENT_NOT_ENABLED')
  })

  it('keeps deployment dispatch private, coding-only and owned by the current actor', async () => {
    const calls: string[] = []
    const manager = new ToolSandboxManager(['coding', 'browser'].map(templateKey => ({
      templateKey, serviceKey: `tools-${templateKey}`, enabled: true, capabilities: [],
    })), async template => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: template.templateKey,
        operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async () => { calls.push('ordinary'); return { exitCode: 0, stdout: '', stderr: '' } },
      executeWithDeployment: async () => { calls.push('deployment'); return { exitCode: 0, stdout: '', stderr: '' } },
      release: async () => {},
    }))
    const coding = await manager.acquire('alice', 'coding', 'one')
    const browser = await manager.acquire('alice', 'browser', 'two')
    await manager.execute('alice', coding.leaseId, ['probe'])
    await expect(manager.executeWithDeployment('bob', coding.leaseId, ['probe'])).rejects.toThrow()
    await expect(manager.executeWithDeployment('alice', browser.leaseId, ['probe'])).rejects.toThrow('DEPLOYMENT_REQUIRES_CODING')
    await manager.executeWithDeployment('alice', coding.leaseId, ['probe'])
    expect(calls).toEqual(['ordinary', 'deployment'])
    await manager.dispose()
  })
})
