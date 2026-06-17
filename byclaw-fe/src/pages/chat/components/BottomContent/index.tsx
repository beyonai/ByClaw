import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Tabs } from 'antd';
import { useIntl, useSelector } from '@umijs/max';

import useGlobal from '@/hooks/useGlobal';

import RecommendQuestion from './recommendQuestion';
import RecommendTabs from './recommendTabs';
import SuggestSkill from './suggestSkill';
import SystemNotification from './systemNotification';

import type { TabsProps } from 'antd/lib/tabs';
import styles from './index.module.less';

export default function BottomContent() {
  const intl = useIntl();

  const { agentInfo } = useGlobal();
  const { agentId } = agentInfo || {};

  const [currentTab, setCurrentTab] = useState('suggestQuestion');
  const oldTabKeyRef = useRef('suggestQuestion');

  const userInfo = useSelector(({ user }) => user.userInfo);

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

    if (userInfo) {
      items.push({
        key: 'systemNotification',
        label: intl.formatMessage({ id: 'chat.bottomContent.systemNotification' }),
        children: <SystemNotification />,
      });
    }

    return items;
  }, [intl, agentId, userInfo]);

  useEffect(() => {
    if (agentId) {
      setCurrentTab('suggestSkill');
      return;
    }

    setCurrentTab(oldTabKeyRef.current === 'suggestSkill' ? 'suggestQuestion' : oldTabKeyRef.current);
  }, [agentId]);

  return (
    <div className={styles.bottomContent}>
      <Tabs
        centered
        activeKey={currentTab}
        onChange={(key) => {
          setCurrentTab(key);
          oldTabKeyRef.current = key;
        }}
        items={tabList || []}
      />
    </div>
  );
}
