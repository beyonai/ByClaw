/** Reserved personal parameters: never part of an ordinary tool process environment. */
export const isDeploymentParameter = (name: string): boolean => name.startsWith('BYCLAW_DEPLOY_')

const fields = ['ENABLED', 'HOST', 'PORT', 'USER', 'PRIVATE_KEY', 'HOST_KEY', 'ROOT'] as const

export function deploymentConfigured(source: Readonly<Record<string, string>>): boolean {
  return source.BYCLAW_DEPLOY_ENABLED === undefined
    ? Boolean(source.BYCLAW_DEPLOY_HOST?.trim() && source.BYCLAW_DEPLOY_PRIVATE_KEY?.trim())
    : source.BYCLAW_DEPLOY_ENABLED === '1'
}

/** Resolve through the context's user-scoped credential provider, not a cloud startup spec. */
export async function loadDeploymentCredentials(resolve: (name: string) => Promise<{ value: string } | undefined>): Promise<Record<string, string>> {
  const pairs = await Promise.all(fields.map(async field => {
    const name = `BYCLAW_DEPLOY_${field}`
    const value = await resolve(name)
    return value === undefined ? [] : [[name, value.value]]
  }))
  return Object.fromEntries(pairs.flat())
}

/** Enabled target/key parameters grant coding access; an optional switch can explicitly pause it. */
export function deploymentEnvironment(source: Readonly<Record<string, string>>): Record<string, string> {
  if (!deploymentConfigured(source)) throw new Error('DEPLOYMENT_NOT_ENABLED')
  return { ...Object.fromEntries(fields.flatMap(field => {
    const name = `BYCLAW_DEPLOY_${field}`
    return source[name] === undefined ? [] : [[name, source[name]]]
  })), BYCLAW_DEPLOY_ENABLED: '1' }
}
