import { calculateSandboxStatus, summarizeSandboxes } from '../statusUtils';

describe('sandbox status utilities', () => {
  const sandbox = (sandboxType: string, status: string) => ({
    userCode: 'user001',
    sandboxType,
    sandboxId: `${sandboxType}-id`,
    status,
  });

  it('uses transitioning as the aggregate status when any service is changing', () => {
    expect(calculateSandboxStatus([sandbox('openclaw', 'RUNNING'), sandbox('byclaw-dsh', 'STARTING')])).toBe(
      'transitioning'
    );
  });

  it('summarizes multiple sandbox services independently', () => {
    expect(
      summarizeSandboxes([
        sandbox('openclaw', 'RUNNING'),
        sandbox('byclaw-dsh', 'STARTING'),
        sandbox('local-agent', 'FAILED'),
      ])
    ).toEqual({ running: 1, transitioning: 1, stopped: 1, total: 3 });
  });
});
