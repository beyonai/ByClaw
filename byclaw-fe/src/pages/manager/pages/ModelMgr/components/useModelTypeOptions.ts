import { useEffect, useMemo, useState } from 'react';
import { getLocale, useIntl } from '@umijs/max';
import { getByParamGroupCode } from '@/pages/manager/service/System';

type Option = { label: string; value: string };

// 列表筛选与编辑表单共用系统字典，保留表单原有的异常兜底及文生图兼容项。
export default function useModelTypeOptions(enabled = true) {
  const intl = useIntl();
  const isEN = getLocale().includes('en');
  const fallbackOptions = useMemo<Option[]>(
    () =>
      ['LLM', 'RERANK', 'EMBEDDING', 'TTS', 'IMAGE_GENERATION'].map((value) => ({
        label: intl.formatMessage({ id: `modelMgr.modal.modelType${value}` }),
        value,
      })),
    [intl]
  );
  const [options, setOptions] = useState<Option[]>(fallbackOptions);

  useEffect(() => {
    if (!enabled) return;
    let canceled = false;
    getByParamGroupCode({ paramGroupCode: 'SYSTEM_MODEL_TYPE' })
      .then((res: any) => {
        const list = res?.data?.byaiSystemConfigLists;
        const configured: Option[] = Array.isArray(list)
          ? list
              .filter((item: any) => item?.paramValue)
              .map((item: any) => ({
                label: (isEN ? item.paramEnName : item.paramName) || item.paramName || item.paramValue,
                value: item.paramValue,
              }))
          : [];
        const imageOption = fallbackOptions.find((item) => item.value === 'IMAGE_GENERATION');
        const nextOptions = configured.length
          ? imageOption && !configured.some((item) => item.value === imageOption.value)
            ? [...configured, imageOption]
            : configured
          : fallbackOptions;
        if (!canceled) setOptions(nextOptions);
      })
      .catch(() => {
        if (!canceled) setOptions(fallbackOptions);
      });
    return () => {
      canceled = true;
    };
  }, [enabled, fallbackOptions, isEN]);

  return options;
}
