import { buildAutomationCron, buildAutomationSchedule, getAutomationListGroup } from './schedule';

describe('automation schedule', () => {
  it('uses a weekly cron candidate for biweekly schedules', () => {
    expect(
      buildAutomationCron({
        mode: 'periodic',
        periodType: 'biweekly',
        time: '09:30',
        weekdays: [1, 5],
      })
    ).toBe('30 9 * * 1,5');
  });

  it('includes month and day for yearly schedules', () => {
    expect(
      buildAutomationCron({
        mode: 'periodic',
        periodType: 'yearly',
        time: '08:15',
        month: 6,
        monthDay: 18,
      })
    ).toBe('15 8 18 6 *');
  });

  it('supports multiple days for monthly schedules', () => {
    const schedule = buildAutomationSchedule({
      sourceName: 'monthly',
      scheduleMode: 'periodic',
      periodType: 'monthly',
      periodTime: undefined,
      periodMonthDays: [18, 2, 18],
    });

    expect(buildAutomationCron({ ...schedule, time: '08:15' })).toBe('15 8 2,18 * *');
  });

  it('keeps unlimited interval hours in config and uses hourly cron candidates', () => {
    const schedule = buildAutomationSchedule({
      sourceName: 'long interval',
      scheduleMode: 'interval',
      intervalHours: 72,
      intervalWeekdays: [1, 2, 3, 4, 5, 6, 7],
    });

    expect(schedule.intervalHours).toBe(72);
    expect(buildAutomationCron(schedule)).toBe('0 * * * 1,2,3,4,5,6,7');
  });

  it('groups tasks by running and enabled status', () => {
    expect(getAutomationListGroup({ sourceId: 1, enabled: '1', status: 'running' })).toBe('running');
    expect(getAutomationListGroup({ sourceId: 2, enabled: '1' })).toBe('current');
    expect(getAutomationListGroup({ sourceId: 3, enabled: '0', status: 'running' })).toBe('paused');
  });
});
