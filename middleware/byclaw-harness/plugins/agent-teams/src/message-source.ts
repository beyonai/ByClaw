/**
 * Durable message source for AgentTeams-originated deliveries (captain wakeups,
 * member followups, submitted-task notices). DSH 0.2.1 replaced the generic
 * `{ kind: 'plugin', plugin }` source with plugin-declared `plugin:<name>` kinds.
 * @module dsh-agent-teams/message-source
 */

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-agent-teams': { kind: 'plugin:dsh-agent-teams' }
  }
}

export {}
