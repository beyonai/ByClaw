import dayjs, { type Dayjs } from 'dayjs';
import { ResourceTypeMap } from '@/constants/resource';
import type {
  AutomationChatConfig,
  AutomationFormValues,
  AutomationScheduleConfig,
  AutomationSource,
  AutomationIntervalUnit,
} from './types';

const getDigitalEmployeeIdentity = (employee: any) =>
  [employee?.agentId, employee?.id, employee?.resourceId, employee?.resourceCode]
    .filter((value) => value !== undefined && value !== null && `${value}` !== '')
    .map((value) => `${value}`);

const getDigitalEmployeeName = (employee: any) =>
  employee?.resourceName || employee?.name || employee?.resourceDesc || employee?.agentName;

/** 将任务配置中用于执行的数字员工占位符转换为卡片可读名称。 */
export const resolveAutomationPromptDisplayText = (prompt: string, resourceList: any[] = [], employees: any[] = []) => {
  if (!prompt) return '';

  const resourcesById = new Map<string, string>();
  const employeeIds = new Set<string>();
  const employeeNames = new Set<string>();
  const addResource = (resource: any) => {
    const name = getDigitalEmployeeName(resource) || resource?.resourceName || resource?.name;
    if (!name) return;
    const resourceId = resource?.resourceId ?? resource?.id;
    const resourceType = resource?.resourceType || resource?.resourceBizType;
    if (resourceType === ResourceTypeMap.digitalEmployee) {
      employeeNames.add(`${name}`);
      [resource?.id, resourceId]
        .filter((identity) => identity !== undefined && identity !== null && `${identity}` !== '')
        .forEach((identity) => employeeIds.add(`${identity}`));
    }
    [resource?.id, resourceId, resourceType && `${resourceType}_${resourceId}`]
      .filter((identity) => identity !== undefined && identity !== null && `${identity}` !== '')
      .forEach((identity) => resourcesById.set(`${identity}`, `${name}`));
  };

  [...resourceList, ...employees].forEach((employee) => {
    addResource(employee);
    getDigitalEmployeeIdentity(employee).forEach((identity) => {
      const name = getDigitalEmployeeName(employee);
      if (name) {
        employeeIds.add(identity);
        employeeIds.add(`DIG_EMPLOYEE_${identity}`);
        employeeNames.add(name);
        resourcesById.set(identity, `${name}`);
        resourcesById.set(`DIG_EMPLOYEE_${identity}`, `${name}`);
      }
    });
  });

  const displayText = prompt.replace(/\{\{([^}]+)\}\}/g, (placeholder, identity: string) => {
    // 编辑器会分别保存员工节点和技能节点；卡片展示时恢复为“@员工 #技能”的可读格式。
    if (identity.includes('#')) {
      const [employeeIdentity, skillIdentity] = identity.split('#');
      const employeeName = resourcesById.get(employeeIdentity);
      const skillName = skillIdentity ? resourcesById.get(skillIdentity) : undefined;
      if (skillName) {
        return employeeIds.has(employeeIdentity) && employeeName
          ? `#${skillName} `
          : `@${employeeName || employeeIdentity} #${skillName} `;
      }
    }
    const directName = resourcesById.get(identity);
    if (directName) {
      return employeeIds.has(identity) ? `@${directName} ` : `#${directName} `;
    }

    // 数字员工技能引用格式为 DIG_EMPLOYEE_x#SKILL_y，展示为员工名#技能名。
    if (identity.startsWith('DIG_EMPLOYEE_')) {
      const [employeeIdentity, skillIdentity] = identity.split('#');
      const employeeName = resourcesById.get(employeeIdentity);
      const skillName = skillIdentity ? resourcesById.get(skillIdentity) : undefined;
      if (employeeName && skillName) return `@${employeeName} #${skillName} `;
      if (employeeName) return `@${employeeName} `;
    }
    return placeholder;
  });

  return Array.from(employeeNames)
    .reduce((text, name) => text.replaceAll(`@${name} @${name} #`, `@${name} #`), displayText)
    .trimEnd();
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export const normalizeIntervalValue = (value: unknown, unit: AutomationIntervalUnit = 'hour') => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return unit === 'minute' ? 60 : 1;
  if (unit === 'minute') return Math.max(60, Math.round(numericValue));
  return Math.max(1, Math.round(numericValue * 10) / 10);
};

export const parseAutomationConfig = (config?: string): AutomationChatConfig => {
  if (!config) return { chatContent: '', resourceList: [] };
  try {
    const parsed = JSON.parse(config);
    if (!parsed || typeof parsed !== 'object') return { chatContent: '', resourceList: [] };
    return {
      ...parsed,
      chatContent: parsed.chatContent || '',
      resourceList: Array.isArray(parsed.resourceList) ? parsed.resourceList : [],
    };
  } catch {
    return { chatContent: '', resourceList: [] };
  }
};

const parseLegacyCron = (cronExpr?: string): AutomationScheduleConfig | undefined => {
  if (!cronExpr) return undefined;
  const rawParts = cronExpr.trim().split(/\s+/);
  const parts = rawParts.length === 6 ? rawParts.slice(1) : rawParts;
  if (parts.length !== 5) return undefined;
  const [minute, hour, day, month, weekday] = parts;
  if (minute.startsWith('*/') && hour === '*') {
    const intervalValue = normalizeIntervalValue(minute.slice(2), 'minute');
    return {
      mode: 'interval',
      intervalValue,
      intervalUnit: 'minute',
      intervalWeekdays: [...ALL_WEEKDAYS],
    };
  }
  if (hour.startsWith('*/')) {
    return {
      mode: 'interval',
      intervalHours: Math.max(1, Number(hour.slice(2)) || 1),
      intervalValue: Math.max(1, Number(hour.slice(2)) || 1),
      intervalUnit: 'hour',
      intervalWeekdays:
        weekday === '*' || weekday === '?' ? [...ALL_WEEKDAYS] : weekday.split(',').map(Number).filter(Boolean),
    };
  }
  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return undefined;
  const time = `${`${hourValue}`.padStart(2, '0')}:${`${minuteValue}`.padStart(2, '0')}`;
  if (weekday !== '*' && weekday !== '?') {
    return {
      mode: 'periodic',
      periodType: 'weekly',
      time,
      weekdays: weekday.split(',').map(Number).filter(Boolean),
    };
  }
  if (month !== '*' && day !== '*') {
    return {
      mode: 'periodic',
      periodType: 'yearly',
      time,
      month: Number(month) || 1,
      monthDay: Number(day) || 1,
    };
  }
  if (day !== '*') {
    const monthDays = day
      .split(',')
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 31);
    return {
      mode: 'periodic',
      periodType: 'monthly',
      time,
      monthDay: monthDays[0] || 1,
      monthDays: monthDays.length ? monthDays : [1],
    };
  }
  return { mode: 'periodic', periodType: 'daily', time };
};

export const getAutomationSchedule = (source?: AutomationSource) =>
  parseAutomationConfig(source?.config).schedule || parseLegacyCron(source?.cronExpr);

const parseTime = (value?: string) => {
  if (!value) return dayjs().hour(9).minute(0).second(0);
  const [hour, minute] = value.split(':').map(Number);
  return dayjs()
    .hour(Number.isFinite(hour) ? hour : 9)
    .minute(Number.isFinite(minute) ? minute : 0)
    .second(0);
};

const parsePeriodDateTime = (schedule?: AutomationScheduleConfig) =>
  parseTime(schedule?.time)
    .date(1)
    .month(Math.max(0, Math.min(11, (schedule?.month || 1) - 1)))
    .date(Math.max(1, schedule?.monthDay || 1));

export const getAutomationFormInitialValues = (source?: AutomationSource): AutomationFormValues => {
  const config = parseAutomationConfig(source?.config);
  const schedule = config.schedule || parseLegacyCron(source?.cronExpr);
  return {
    sourceName: source?.sourceName || '',
    projectId: source?.projectId === undefined || source?.projectId === null ? undefined : `${source.projectId}`,
    scheduleMode: schedule?.mode || 'periodic',
    periodType: schedule?.periodType || 'daily',
    periodTime: parseTime(schedule?.time),
    periodDateTime: parsePeriodDateTime(schedule),
    periodWeekdays: schedule?.weekdays?.length ? schedule.weekdays : [...DEFAULT_WEEKDAYS],
    periodMonth: schedule?.month || 1,
    periodMonthDay: schedule?.monthDay || 1,
    periodMonthDays: schedule?.monthDays?.length ? schedule.monthDays : [schedule?.monthDay || 1],
    intervalHours: schedule?.intervalHours || 1,
    intervalValue: normalizeIntervalValue(
      schedule?.intervalValue ?? schedule?.intervalHours,
      schedule?.intervalUnit || 'hour'
    ),
    intervalUnit: schedule?.intervalUnit || 'hour',
    intervalWeekdays: schedule?.intervalWeekdays?.length ? schedule.intervalWeekdays : [...DEFAULT_WEEKDAYS],
    onceTime: schedule?.onceTime ? dayjs(schedule.onceTime) : dayjs().add(1, 'hour').startOf('minute'),
  };
};

export const buildAutomationSchedule = (values: AutomationFormValues): AutomationScheduleConfig => {
  const base = {
    mode: values.scheduleMode,
  };
  if (values.scheduleMode === 'once') {
    return {
      ...base,
      onceTime: values.onceTime?.format('YYYY-MM-DD HH:mm:ss'),
    };
  }
  if (values.scheduleMode === 'interval') {
    const intervalUnit: AutomationIntervalUnit = values.intervalUnit || 'hour';
    const intervalValue = normalizeIntervalValue(values.intervalValue ?? values.intervalHours, intervalUnit);
    return {
      ...base,
      intervalValue,
      intervalUnit,
      // 保留旧字段给历史前端/接口兼容；分钟间隔不能伪装成小时，避免后端优先读取旧字段。
      ...(intervalUnit === 'hour' ? { intervalHours: intervalValue } : {}),
      intervalWeekdays: values.intervalWeekdays?.length ? values.intervalWeekdays : [...ALL_WEEKDAYS],
    };
  }
  const yearlyDateTime = values.periodDateTime || values.periodTime;
  const isYearly = values.periodType === 'yearly';
  return {
    ...base,
    periodType: values.periodType || 'daily',
    time: (isYearly ? yearlyDateTime : values.periodTime)?.format('HH:mm') || '09:00',
    weekdays: values.periodWeekdays,
    month: isYearly && yearlyDateTime ? yearlyDateTime.month() + 1 : values.periodMonth,
    monthDay: isYearly && yearlyDateTime ? yearlyDateTime.date() : values.periodMonthDay,
    monthDays:
      values.periodType === 'monthly'
        ? Array.from(
          new Set(
            (values.periodMonthDays?.length ? values.periodMonthDays : [values.periodMonthDay || 1]).map(Number)
          )
        )
          .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31)
          .sort((left, right) => left - right)
        : undefined,
  };
};

export const buildAutomationCron = (schedule: AutomationScheduleConfig) => {
  if (schedule.mode === 'once') {
    const value = dayjs(schedule.onceTime);
    return value.isValid() ? `${value.minute()} ${value.hour()} ${value.date()} ${value.month() + 1} *` : undefined;
  }
  if (schedule.mode === 'interval') {
    const weekdays = schedule.intervalWeekdays?.length ? schedule.intervalWeekdays.join(',') : '*';
    const intervalUnit = schedule.intervalUnit || 'hour';
    const intervalValue = normalizeIntervalValue(schedule.intervalValue ?? schedule.intervalHours, intervalUnit);
    if (intervalUnit === 'minute') {
      // 分钟值最小为 60，Cron 只负责提供足够高频的候选点，实际间隔由 lastScanTime 校验。
      return `* * * * ${weekdays}`;
    }
    if (Number.isInteger(intervalValue) && intervalValue <= 23) {
      return `0 */${intervalValue} * * ${weekdays}`;
    }
    if (!Number.isInteger(intervalValue)) {
      // 小数小时无法直接表达为标准 Cron，使用每分钟候选点并由结构化配置控制实际间隔。
      return `* * * * ${weekdays}`;
    }
    // 超过 23 小时无法由标准 Cron 精确表达，使用每小时候选点，由结构化配置和 lastScanTime 控制实际间隔。
    return `0 * * * ${weekdays}`;
  }
  const value = parseTime(schedule.time);
  if (schedule.periodType === 'weekly' || schedule.periodType === 'biweekly') {
    const weekdays = schedule.weekdays?.length ? schedule.weekdays.join(',') : '*';
    return `${value.minute()} ${value.hour()} * * ${weekdays}`;
  }
  if (schedule.periodType === 'yearly') {
    const month = Math.min(12, Math.max(1, Number(schedule.month) || 1));
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    const monthDay = Math.min(maxDay, Math.max(1, Number(schedule.monthDay) || 1));
    return `${value.minute()} ${value.hour()} ${monthDay} ${month} *`;
  }
  if (schedule.periodType === 'monthly') {
    const monthDays = schedule.monthDays?.length ? schedule.monthDays : [schedule.monthDay || 1];
    return `${value.minute()} ${value.hour()} ${monthDays.join(',')} * *`;
  }
  return `${value.minute()} ${value.hour()} * * *`;
};

export const isAutomationEnabled = (source: AutomationSource) =>
  source.enabled === '1' || source.enabled === 1 || source.enabled === true;

export type AutomationListGroup = 'running' | 'current' | 'paused';

export const getAutomationListGroup = (source: AutomationSource): AutomationListGroup => {
  if (!isAutomationEnabled(source)) return 'paused';
  if (source.running === true) return 'running';
  return ['running', 'in_progress', 'executing', 'pending'].includes(`${source.status || ''}`.toLowerCase())
    ? 'running'
    : 'current';
};

export const getNextRunTime = (source: AutomationSource) => {
  if (!isAutomationEnabled(source)) return null;
  const schedule = getAutomationSchedule(source);
  if (!schedule) return null;
  const now = dayjs();
  if (schedule.mode === 'once') {
    const onceTime = dayjs(schedule.onceTime);
    return onceTime.isValid() && onceTime.isAfter(now) ? onceTime : null;
  }
  if (schedule.mode === 'interval') {
    const intervalUnit = schedule.intervalUnit || 'hour';
    const intervalValue = schedule.intervalValue || schedule.intervalHours || 1;
    const lastRun = dayjs(source.lastScanTime);
    const durationUnit = intervalUnit === 'minute' ? 'minute' : 'hour';
    return lastRun.isValid() ? lastRun.add(intervalValue, durationUnit) : now.add(intervalValue, durationUnit);
  }
  const time = parseTime(schedule.time);
  if (schedule.periodType === 'yearly') {
    const month = Math.min(12, Math.max(1, schedule.month || 1));
    const monthDay = Math.max(1, schedule.monthDay || 1);
    for (let yearOffset = 0; yearOffset <= 8; yearOffset += 1) {
      const year = now.year() + yearOffset;
      const base = dayjs()
        .year(year)
        .month(month - 1)
        .date(monthDay);
      if (base.month() !== month - 1 || base.date() !== monthDay) continue;
      const candidate = base.hour(time.hour()).minute(time.minute()).second(0);
      if (candidate.isAfter(now)) return candidate;
    }
    return null;
  }
  if (schedule.periodType === 'monthly') {
    const monthDays = schedule.monthDays?.length ? schedule.monthDays : [schedule.monthDay || 1];
    const getCandidate = (month: Dayjs) =>
      monthDays
        .map((day) => month.date(Math.min(day, month.daysInMonth())).hour(time.hour()).minute(time.minute()).second(0))
        .sort((left, right) => left.valueOf() - right.valueOf())
        .find((candidate) => candidate.isAfter(now));
    return getCandidate(now) || getCandidate(now.add(1, 'month')) || null;
  }
  if ((schedule.periodType === 'weekly' || schedule.periodType === 'biweekly') && schedule.weekdays?.length) {
    const anchor = dayjs(schedule.effectiveStartDate || source.createTime || now)
      .startOf('week')
      .add(1, 'day');
    const maxOffset = schedule.periodType === 'biweekly' ? 14 : 7;
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidate = now.add(offset, 'day').hour(time.hour()).minute(time.minute()).second(0);
      const weekday = candidate.day() === 0 ? 7 : candidate.day();
      const weekOffset = candidate.startOf('week').add(1, 'day').diff(anchor, 'week');
      const matchesCycle = schedule.periodType !== 'biweekly' || (weekOffset >= 0 && weekOffset % 2 === 0);
      if (matchesCycle && schedule.weekdays.includes(weekday) && candidate.isAfter(now)) return candidate;
    }
  }
  const today = now.hour(time.hour()).minute(time.minute()).second(0);
  return today.isAfter(now) ? today : today.add(1, 'day');
};
