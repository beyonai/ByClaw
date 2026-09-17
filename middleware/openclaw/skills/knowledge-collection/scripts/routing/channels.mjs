// Skill channels only. Provider/domain selection belongs to the registered skill.
function register(owner, publicationOwner, group) {
  return Object.freeze({ owner, publicationOwner, group, routeContractVersion: 1,
    contextType: group === 'mail' ? 'mail-account-binding' : 'collection-session',
    recovery: 'non-resumable', budgetOwner: group === 'mail' ? 'mail' : 'workflow',
    describe: async (request, session, deps = {}) => group === 'mail'
      ? (deps.describe || (await import('../../../mail/scripts/collection-facade.mjs')).describeCapabilities)({ mailBindings: session.task.mailBindings }, request.selector)
      : (await import('./workflows.mjs')).evaluateWorkflow(request, session),
    execute: async (paths, plan, session, deps) => group === 'mail'
      ? (await import('./mail-workflow.mjs')).runMailWorkflow(paths, plan, session, deps)
      : (await import('./workflows.mjs')).executeRouteWorkflow(paths, plan, session, deps),
    executeLegacy: (command, args, fixedExecutor) => fixedExecutor(command, args),
  });
}
export const channels = Object.freeze({
  'public-internet': register('public-workflow', 'workflow', 'public'),
  dingtalk: register('dws', 'workflow', 'enterprise'),
  feishu: register('fws', 'workflow', 'enterprise'),
  wecom: register('wecomcli', 'workflow', 'enterprise'),
  ima: register('ima-workflow', 'workflow', 'enterprise'),
  'cloud-knowledge': register('project-cloud-knowledge', 'workflow', 'enterprise'),
  mail: register('mail', 'collection', 'mail'),
});

const publicCommands = new Set(['public-discover', 'public-collect', 'acquire-web', 'materialize-web',
  'materialize-wechat', 'materialize-arxiv', 'unified-search', 'unified-materialize', 'crawl-seed', 'crawl-next', 'crawl-mark']);
export function legacyChannel(command, source) {
  if (command === 'enterprise') return Object.hasOwn(channels, source) && source !== 'mail' ? source : null;
  return publicCommands.has(command) ? 'public-internet' : null;
}

export function registeredChannel(channel) {
  if (!Object.hasOwn(channels, channel)) throw new Error('UNKNOWN_CHANNEL');
  return channels[channel];
}
