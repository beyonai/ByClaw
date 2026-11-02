import { isDshRuntime, isOpenClawRuntime, resolveChatRuntimeType } from '../chatRuntime';

describe('chatRuntime', () => {
  it('prefers an explicit server-resolved runtime', () => {
    expect(resolveChatRuntimeType({ runtimeType: 'dsh', agentType: '013' })).toBe('dsh');
    expect(resolveChatRuntimeType({ runtimeType: 'openclaw', enableDsh: '1' })).toBe('dsh');
    expect(resolveChatRuntimeType({ runtimeType: 'dsh', sourceAgentType: 'HARNESS_user-a', enableDsh: '0' })).toBe(
      'openclaw'
    );
  });

  it('recognizes DSH source and target prefixes', () => {
    expect(isDshRuntime({ sourceAgentType: 'BYCLAW_DSH_user-a' })).toBe(true);
    expect(isDshRuntime({ targetAgentType: 'HARNESS_user-a' })).toBe(true);
  });

  it('accepts the effective ENABLE_DSH value', () => {
    expect(isDshRuntime({ enableDsh: ' 1\n' })).toBe(true);
    expect(resolveChatRuntimeType({ enableDsh: '0', agentType: '013' })).toBe('openclaw');
  });

  it('recognizes legacy OpenClaw employee metadata and preserves unknown state', () => {
    expect(isOpenClawRuntime({ agentType: '013' })).toBe(true);
    expect(isOpenClawRuntime({ agentDevType: 'OpenClaw' })).toBe(true);
    expect(resolveChatRuntimeType()).toBe('unknown');
  });
});
