import React, { useEffect, useMemo, useState } from 'react';
import { RichInputResourceList } from '../../RichInput';
import getDisplayQuestion from '../../getDisplayQuestion';
import useQryResourceList from './useQryResourceList';

interface ResourceQuestionProps {
  text: string;
}

export const ResourceQuestion: React.FC<ResourceQuestionProps> = ({ text }) => {
  const [resourceList, setResourceList] = useState<RichInputResourceList>([]);
  const qryResourceList = useQryResourceList();

  useEffect(() => {
    if (!text) {
      setResourceList([]);
      return;
    }

    qryResourceList(text, true).then((list) => {
      setResourceList(list);
    });
  }, [text]);

  const displayText = useMemo(() => {
    // 还没加载出资源列表，暂时将{{}}替换为空
    if (!resourceList.length) return text.replace(/\{\{[^}]+\}\}/g, '');
    return getDisplayQuestion({ text, resourceList });
  }, [text, resourceList]);
  return <>{displayText}</>;
};
