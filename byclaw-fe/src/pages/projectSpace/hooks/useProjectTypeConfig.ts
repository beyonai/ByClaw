import { useEffect, useMemo, useState } from 'react';
import { getDcSystemConfigListByStandType } from '@/service/system';
import { PROJECT_TYPE_OPTIONS, PROJECT_TYPE_STAND_TYPE } from '../constants';
import type { ProjectSpace } from '../types';

export type ProjectTypeOption = {
  label: string;
  value: ProjectSpace['projectType'];
  disabled?: boolean;
};

const SUPPORTED_PROJECT_TYPE_SET = new Set<ProjectSpace['projectType']>(['normal', 'develop']);

const getStaticConfigList = (response: any): any[] => {
  const candidates = [response, response?.data, response?.data?.data];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.rows)) return candidate.rows;
    if (Array.isArray(candidate?.list)) return candidate.list;
    if (Array.isArray(candidate?.byaiSystemConfigLists)) return candidate.byaiSystemConfigLists;
  }

  return [];
};

const normalizeProjectType = (value: unknown) => {
  const normalizedValue = `${value || ''}`.trim().toLowerCase();
  // 兼容早期接口中 development 的类型值，统一由当前研发项目逻辑处理。
  return normalizedValue === 'development' ? 'develop' : normalizedValue;
};

export const getProjectTypeOptionsFromConfig = (response: any): ProjectTypeOption[] => {
  return getStaticConfigList(response)
    .map((item, index) => {
      const value = normalizeProjectType(item?.paramValue ?? item?.paramEnName ?? item?.value);
      const sequence = Number(item?.paramSeq ?? item?.param_seq ?? index);
      return {
        label: item?.paramName || item?.paramDesc || item?.paramEnName || value,
        value,
        sequence: Number.isFinite(sequence) ? sequence : index,
      };
    })
    .filter((item) => SUPPORTED_PROJECT_TYPE_SET.has(item.value as ProjectSpace['projectType']))
    .sort((left, right) => left.sequence - right.sequence)
    .map((item) => ({
      label: item.label,
      value: item.value as ProjectSpace['projectType'],
    }));
};

export const useProjectTypeConfig = () => {
  const [projectTypeOptions, setProjectTypeOptions] = useState<ProjectTypeOption[]>(PROJECT_TYPE_OPTIONS);
  const [projectTypeLoading, setProjectTypeLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setProjectTypeLoading(true);

    getDcSystemConfigListByStandType(PROJECT_TYPE_STAND_TYPE, { responseCfg: { hideErrorTips: true } })
      .then((response) => {
        if (!active) return;
        const nextOptions = getProjectTypeOptionsFromConfig(response);
        // 接口为空或环境仅部署普通项目时，都使用接口实际可用的项目类型。
        setProjectTypeOptions(nextOptions.length ? nextOptions : PROJECT_TYPE_OPTIONS);
      })
      .catch((error) => {
        console.error('Failed to load project type config:', error);
        if (active) {
          // 配置接口异常时保守降级为普通项目，避免研发功能误开放。
          setProjectTypeOptions(PROJECT_TYPE_OPTIONS);
        }
      })
      .finally(() => {
        if (active) setProjectTypeLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const isDevelopProjectEnabled = useMemo(
    () => projectTypeOptions.some((option) => option.value === 'develop'),
    [projectTypeOptions]
  );

  return {
    projectTypeOptions,
    projectTypeLoading,
    isDevelopProjectEnabled,
  };
};
