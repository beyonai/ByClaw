import type { IAgentCache } from '@/typescript/agent';
import dayjs from 'dayjs';

const getEmployeeResourceId = (employee: IAgentCache) =>
  `${employee.resourceId ?? employee.id ?? employee.agentId ?? ''}`;

export const sortDefaultDigitalEmployeeFirst = (employees: IAgentCache[] = [], defaultResourceId?: string | number) => {
  if (defaultResourceId === undefined || defaultResourceId === null || `${defaultResourceId}` === '') {
    return employees;
  }

  return [...employees].sort((left, right) => {
    const leftIsDefault = getEmployeeResourceId(left) === `${defaultResourceId}`;
    const rightIsDefault = getEmployeeResourceId(right) === `${defaultResourceId}`;
    return Number(rightIsDefault) - Number(leftIsDefault);
  });
};

const getEmployeeTimestamp = (employee: IAgentCache) => {
  for (const value of [(employee as any)?.updateTime, (employee as any)?.createTime]) {
    if (value === undefined || value === null || `${value}`.trim() === '') continue;

    const normalizedValue = `${value}`.trim();
    const timestamp = /^\d+$/.test(normalizedValue)
      ? dayjs(Number(normalizedValue) * (normalizedValue.length === 10 ? 1000 : 1)).valueOf()
      : dayjs(normalizedValue).valueOf();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
};

export const sortDigitalEmployeeByRecent = (employees: IAgentCache[] = []) =>
  [...employees].sort((left, right) => getEmployeeTimestamp(right) - getEmployeeTimestamp(left));
