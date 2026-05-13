import useKnowledge from '@/hooks/useKnowledge';
import { knowledgeBaseListItem } from '@/typescript/chatbi';
import AntdIcon from '@/components/AntdIcon';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Select } from 'antd';
import React, { useCallback, useImperativeHandle, useMemo } from 'react';

type IProps = Record<string, any>

const KnowledgeSelect = (props: IProps, ref: any) => {
  const intl = useIntl();

  const { knowledgeBaseList, selectedKnowledgeInfo, setSelectedKnowledgeInfo, setDvaState } = useKnowledge();

  // 把setSelectedKnowledgeInfo抛给父组件调用
  useImperativeHandle(ref, () => ({
    setSelectedKnowledgeInfo,
  }));

  const options = useMemo(() => {
    if (!knowledgeBaseList) {
      return [];
    }
    return knowledgeBaseList.map((item: knowledgeBaseListItem) => ({
      value: item.knowledgeBaseId,
      label: item.knowledgeBaseName,
    }));
  }, [knowledgeBaseList]);

  const onChange = useCallback(
    (value: string) => {
      if (!value) {
        // 清空了
        setSelectedKnowledgeInfo(null);
        setDvaState({ selectedKnowledgeInfo: null });
      } else {
        const target = knowledgeBaseList?.find(
          (base: knowledgeBaseListItem) => `${base.knowledgeBaseId}` === `${value}`
        );
        setSelectedKnowledgeInfo(target ?? null);
        setDvaState({ selectedKnowledgeInfo: target ?? null });
      }
    },
    [knowledgeBaseList]
  );

  const loading = !knowledgeBaseList;

  return (
    <Select
      showSearch
      allowClear
      popupMatchSelectWidth={false}
      prefix={selectedKnowledgeInfo ? undefined : <AntdIcon type="icon-a-Add-onetianjia" />}
      placeholder={intl.formatMessage({ id: 'chatBI.selectKnowledgeBase' })}
      value={selectedKnowledgeInfo?.knowledgeBaseId || undefined}
      onChange={onChange}
      loading={loading}
      options={options}
      optionFilterProp="label"
    />
  );
};

export default React.forwardRef(KnowledgeSelect);
