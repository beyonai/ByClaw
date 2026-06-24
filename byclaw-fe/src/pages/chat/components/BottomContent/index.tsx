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
import { isEmpty } from 'lodash';

const emptyObj: Record<string, unknown> = {};

export default function BottomContent() {
  const intl = useIntl();

  const { agentInfo } = useGlobal();
  const { agentId } = agentInfo || emptyObj;

  const [relatedQuestions, setRelatedQuestions] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState('suggestQuestion');
  const oldTabKeyRef = useRef('suggestQuestion');

  const userInfo = useSelector(({ user }) => user.userInfo);

  const tabList = useMemo<TabsProps['items']>(() => {
    const items: TabsProps['items'] = [
      {
        key: 'suggestQuestion',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestQuestion' }),
        children: <RecommendQuestion relatedQuestions={relatedQuestions} />,
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
        children: <SuggestSkill agentId={agentId as string} />,
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
  }, [intl, agentId, userInfo, relatedQuestions]);

  useEffect(() => {
    const { agentId, prologue } = agentInfo || emptyObj;

    let relatedQuestions: string[] = [];

    try {
      const obj = JSON.parse((prologue as string) || '{}');
      const { openingQuestion } = obj;
      relatedQuestions = JSON.parse(openingQuestion || '[]');
    } catch (error) {
      console.error('Error parsing prologue:', error);
    }

    setRelatedQuestions(relatedQuestions);

    if (!isEmpty(relatedQuestions)) {
      setCurrentTab('suggestQuestion');
      return;
    }

    if (agentId) {
      setCurrentTab('suggestSkill');
      return;
    }

    setCurrentTab(oldTabKeyRef.current === 'suggestSkill' ? 'suggestQuestion' : oldTabKeyRef.current);
  }, [agentInfo]);

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
