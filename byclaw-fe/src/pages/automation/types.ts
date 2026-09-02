import type { Dayjs } from 'dayjs';

export type AutomationScheduleMode = 'periodic' | 'interval' | 'once';
export type AutomationPeriodType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type AutomationIntervalUnit = 'hour' | 'minute';

export interface AutomationScheduleConfig {
  mode: AutomationScheduleMode;
  periodType?: AutomationPeriodType;
  time?: string;
  weekdays?: number[];
  month?: number;
  monthDay?: number;
  monthDays?: number[];
  intervalHours?: number;
  intervalValue?: number;
  intervalUnit?: AutomationIntervalUnit;
  intervalWeekdays?: number[];
  onceTime?: string;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
}

export interface AutomationChatConfig {
  chatContent: string;
  resourceList: any[];
  schedule?: AutomationScheduleConfig;
}

export interface AutomationSource {
  sourceId: string | number;
  sourceName?: string;
  sourceType?: string;
  config?: string;
  cronExpr?: string;
  enabled?: string | number | boolean;
  status?: string;
  running?: boolean;
  lastScanTime?: string;
  projectId?: string | number;
  projectName?: string;
  createBy?: string | number;
  createByName?: string;
  createTime?: string | number;
}

export interface AutomationFormValues {
  sourceName: string;
  projectId?: string;
  scheduleMode: AutomationScheduleMode;
  periodType?: AutomationPeriodType;
  periodTime?: Dayjs;
  periodDateTime?: Dayjs;
  periodWeekdays?: number[];
  periodMonth?: number;
  periodMonthDay?: number;
  periodMonthDays?: number[];
  intervalHours?: number;
  intervalValue?: number;
  intervalUnit?: AutomationIntervalUnit;
  intervalWeekdays?: number[];
  onceTime?: Dayjs;
}

export interface AutomationTemplate {
  key: string;
  name: string;
  prompt: string;
  schedule: AutomationScheduleConfig;
}
