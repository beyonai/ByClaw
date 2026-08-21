import type { IAgentCache } from '@/typescript/agent';

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
