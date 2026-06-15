import React, { useMemo, useState } from 'react';
import { Tabs } from 'antd';
import { useIntl } from '@umijs/max';

import useGlobal from '@/hooks/useGlobal';

import RecommendQuestion from './recommendQuestion';
import RecommendTabs from './recommendTabs';
import SuggestSkill from './suggestSkill';

import type { TabsProps } from 'antd/lib/tabs';
import styles from './index.module.less';

export default function BottomContent() {
  const intl = useIntl();

  const { agentInfo } = useGlobal();
  const { agentId } = agentInfo || {};

  const tabList = useMemo<TabsProps['items']>(() => {
    const items: TabsProps['items'] = [
      {
        key: 'suggestQuestion',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestQuestion' }),
        children: <RecommendQuestion />,
        // destroyOnHidden: true,
      },
      {
        key: 'suggestReplay',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestReplay' }),
        children: <RecommendTabs />,
      },
    ];
    // 仅在存在 agentId 时展示「推荐技能」tab
    if (agentId) {
      items.push({
        key: 'suggestSkill',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestSkill' }),
        children: <SuggestSkill agentId={agentId} />,
        // destroyOnHidden: true,
      });
    }
    return items;
  }, [intl, agentId]);

  const [currentTab, setCurrentTab] = useState('suggestQuestion');

  // 若当前选中的 tab 已不存在（如 agentId 消失导致技能 tab 被移除），回退到首个 tab
  const activeKey = (tabList || []).some((item) => item?.key === currentTab) ? currentTab : tabList?.[0]?.key;

  return (
    <div className={styles.bottomContent}>
      <Tabs centered activeKey={activeKey} onChange={setCurrentTab} items={tabList || []} />
    </div>
  );
}
