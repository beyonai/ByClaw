import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Tabs } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import { isEmpty, compact } from 'lodash';

import useGlobal from '@/hooks/useGlobal';
import { getDcSystemConfig } from '@/pages/manager/service/session';

import RecommendQuestion from './recommendQuestion';
import RecommendTabs from './recommendTabs';
import SuggestSkill from './suggestSkill';
import SystemNotification from './systemNotification';

import type { TabsProps } from 'antd/lib/tabs';
import styles from './index.module.less';

const emptyObj: Record<string, unknown> = {};
const BRAND_VERSION_PARAM_CODE = 'BYAI_BRAND_VERSION';

export default function BottomContent() {
  const intl = useIntl();

  const { agentInfo } = useGlobal();
  const { agentId } = agentInfo || emptyObj;

  const [relatedQuestions, setRelatedQuestions] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState('suggestQuestion');
  const [isCommercial, setIsCommercial] = useState<boolean | null>(null);
  const oldTabKeyRef = useRef('suggestQuestion');

  const userInfo = useSelector(({ user }) => user.userInfo);

  useEffect(() => {
    let disposed = false;
    getDcSystemConfig({ paramCode: BRAND_VERSION_PARAM_CODE })
      .then((result) => {
        if (disposed) return;
        const brandVersion = result?.paramValue ?? result?.data?.paramValue;
        setIsCommercial(brandVersion === 'commercial');
      })
      .catch(() => {
        if (!disposed) {
          // 配置读取失败时保留非商用版入口，避免配置服务短暂异常导致功能误隐藏。
          setIsCommercial(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const tabList = useMemo<TabsProps['items']>(() => {
    const items: TabsProps['items'] = [];
    // 商用版不提供推荐问题和系统通知，配置尚未返回时也先隐藏受限入口，避免出现闪烁。
    if (isCommercial === false) {
      items.push({
        key: 'suggestQuestion',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestQuestion' }),
        children: <RecommendQuestion relatedQuestions={relatedQuestions} />,
        // destroyOnHidden: true,
      });
    }
    items.push({
      key: 'suggestReplay',
      label: intl.formatMessage({ id: 'chat.bottomContent.suggestReplay' }),
      children: <RecommendTabs />,
    });
    // 仅在存在 agentId 时展示「推荐技能」tab
    if (agentId) {
      items.push({
        key: 'suggestSkill',
        label: intl.formatMessage({ id: 'chat.bottomContent.suggestSkill' }),
        children: <SuggestSkill agentId={agentId as string} />,
        // destroyOnHidden: true,
      });
    }

    if (userInfo && isCommercial === false) {
      items.push({
        key: 'systemNotification',
        label: intl.formatMessage({ id: 'chat.bottomContent.systemNotification' }),
        children: <SystemNotification />,
      });
    }

    return items;
  }, [intl, agentId, userInfo, relatedQuestions, isCommercial]);

  useEffect(() => {
    const { agentId, prologue } = agentInfo || emptyObj;

    let relatedQuestions: string[] = [];

    try {
      const obj = JSON.parse((prologue as string) || '{}');
      const { openingQuestion } = obj;
      relatedQuestions = compact(JSON.parse(openingQuestion || '[]'));
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

  const visibleCurrentTab = tabList?.some((item) => item?.key === currentTab) ? currentTab : tabList?.[0]?.key;

  return (
    <div className={styles.bottomContent}>
      <Tabs
        centered
        activeKey={visibleCurrentTab}
        onChange={(key) => {
          setCurrentTab(key);
          oldTabKeyRef.current = key;
        }}
        items={tabList || []}
        className={styles.tabs}
      />
    </div>
  );
}
