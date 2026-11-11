/** Reserved personal parameters: never part of an ordinary tool process environment. */
export const isDeploymentParameter = (name: string): boolean => name.startsWith('BYCLAW_DEPLOY_')

const fields = ['ENABLED', 'HOST', 'PORT', 'USER', 'PRIVATE_KEY', 'HOST_KEY', 'ROOT'] as const

/** Enabled target/key parameters grant coding access; an optional switch can explicitly pause it. */
export function deploymentEnvironment(source: Readonly<Record<string, string>>): Record<string, string> {
  const enabled = source.BYCLAW_DEPLOY_ENABLED
  if (enabled === undefined ? !source.BYCLAW_DEPLOY_HOST?.trim() || !source.BYCLAW_DEPLOY_PRIVATE_KEY?.trim() : enabled !== '1') throw new Error('DEPLOYMENT_NOT_ENABLED')
  return { ...Object.fromEntries(fields.flatMap(field => {
    const name = `BYCLAW_DEPLOY_${field}`
    return source[name] === undefined ? [] : [[name, source[name]]]
  })), BYCLAW_DEPLOY_ENABLED: '1' }
}
