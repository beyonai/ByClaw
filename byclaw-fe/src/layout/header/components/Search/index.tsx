import React, { useCallback, useEffect, useState, useMemo } from 'react';
// @ts-ignore
import { connect, useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import { Input, message } from 'antd';
import { canJumpAgent, agentHandler, getAgentPath } from '@/utils/agent';
import { escapeRegExp } from '@/utils/tools';
import classnames from 'classnames';
import useGlobal from '@/hooks/useGlobal';
import useTracker from '@/hooks/useTracker';
import useVisibleMenuKeys from '@/layout/sider/useVisibleMenuKeys';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import KnowledgeBaseListItem from '@/layout/sider/components/Knowledge/components/KnowledgeBase/KnowledgeBaseListItem';
import { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import ResourceSiderListItem from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';

import styles from './index.module.less';
import { SearchOutlined } from '@ant-design/icons';
import type { HeaderSearchPageProps, SearchTabItem } from './types';
import { normalizeResourceItem, resourceSiderTypeByTabKey } from './utils';
import useHeaderSearchResults from './useHeaderSearchResults';
import useEmployeeResourceSearch from './useEmployeeResourceSearch';
import useKnowledgeResourceInteraction from './useKnowledgeResourceInteraction';
import useEmployeeResourceDrill from './useEmployeeResourceDrill';
import SearchTabs from './SearchTabs';
import SearchSection from './SearchSection';
import { SearchEmpty, SearchLoading } from './SearchState';
import DigitalEmployeeResultItem from './DigitalEmployeeResultItem';
import ChatRecordResultItem from './ChatRecordResultItem';
import EmployeeResourceContent from './EmployeeResourceContent';

const HeaderSearchPage = (props: HeaderSearchPageProps) => {
  const {
    keyword: ctrlKeyword,
    className,
    setShowSearch,
    onMouseEnter,
    onMouseLeave,
    showSearch,
    displayInModal,
  } = props;
  const intl = useIntl();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const visibleKeys = useVisibleMenuKeys(userInfo);
  const activeSiderAgent = useActiveSiderAgent();

  const { trackerEmployeeClick } = useTracker();

  const { setAgentId, setSessionId, EventEmitter } = useGlobal();

  const [stateKeyword, setStateKeyword] = useState(ctrlKeyword || '');

  const keyword = ctrlKeyword ?? stateKeyword;

  // 当前tab
  const [activeTab, setActiveTab] = useState(intl.formatMessage({ id: 'common.comprehensive' }));

  const { isLoading, result, myGetSearchList, cancelSearch } = useHeaderSearchResults();
  const {
    employeeResourceResultMap,
    visibleEmployeeResourceTabs,
    myGetEmployeeResourceList,
    cancelEmployeeResourceSearch,
  } = useEmployeeResourceSearch({
    visibleKeys,
    activeSiderAgentResourceId: activeSiderAgent.resourceId,
  });
  const {
    currentKnowledgeBase,
    setCurrentKnowledgeBase,
    handleKnowledgeBaseItemClick,
    handleKnowledgeBaseItemDoubleClick,
    handleKnowledgeBaseGoBack,
  } = useKnowledgeResourceInteraction({
    visibleEmployeeResourceTabs,
    eventEmitter: EventEmitter,
    setActiveTab,
  });
  const {
    employeeResourceDrillState,
    employeeResourceDrillLoading,
    resetEmployeeResourceDrill,
    getEmployeeResourceDrillable,
    handleEmployeeResourceItemClick,
    handleEmployeeResourceDoubleClick,
    handleEmployeeResourceGoBack,
  } = useEmployeeResourceDrill({
    visibleEmployeeResourceTabs,
    employeeResourceResultMap,
    eventEmitter: EventEmitter,
    setActiveTab,
  });

  const digitList = useMemo(
    () =>
      (result?.digitList || []).map((item) => {
        return agentHandler(item);
      }),
    [result?.digitList]
  );

  useEffect(() => {
    if (!showSearch) {
      cancelSearch();
      cancelEmployeeResourceSearch();
      setCurrentKnowledgeBase(null);
      resetEmployeeResourceDrill();
      return;
    }
    resetEmployeeResourceDrill();
    myGetSearchList(keyword);
    myGetEmployeeResourceList(keyword);

    return () => {
      cancelSearch();
      cancelEmployeeResourceSearch();
    };
  }, [
    keyword,
    showSearch,
    myGetSearchList,
    myGetEmployeeResourceList,
    cancelSearch,
    cancelEmployeeResourceSearch,
    setCurrentKnowledgeBase,
    resetEmployeeResourceDrill,
  ]);

  /** 弹窗首次打开时立即拉取，避免仅依赖 debounce 的首帧延迟 */
  useEffect(() => {
    if (!showSearch) {
      return;
    }
    myGetSearchList.flush();
    myGetEmployeeResourceList.flush();
  }, [showSearch, myGetSearchList, myGetEmployeeResourceList]);

  // 搜索高亮
  const highlight = useCallback(
    (text: string) => {
      if (!keyword || !text) {
        return text;
      }

      const escapedKeyword = escapeRegExp(keyword);
      const parts = (text || '').split(new RegExp(`(${escapedKeyword})`, 'gi'));

      return parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <span key={i} className={styles.highlight}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      );
    },
    [keyword]
  );

  // 渲染数字员工
  const renderItemEmployee = useCallback(
    (item: any) => {
      const handleClick = (employee: any) => {
        const isCanJump = canJumpAgent(employee);
        if (!isCanJump) {
          message.destroy();
          message.error(intl.formatMessage({ id: 'headerSearch.applyPermissionTip' }));
          return;
        }

        trackerEmployeeClick(employee, 'siderAgentRedirect');

        dispatch({
          type: 'chat/save',
          payload: {
            curSession: {},
          },
        });
        setShowSearch(false);
        setAgentId?.(employee.id);
        navigate(getAgentPath(employee));
      };

      return <DigitalEmployeeResultItem key={item.id} item={item} highlight={highlight} onClick={handleClick} />;
    },
    [dispatch, highlight, intl, navigate, setAgentId, setShowSearch, trackerEmployeeClick]
  );

  // 渲染聊天记录
  const renderItemChat = useCallback(
    (item: any) => {
      const handleClick = (chat: any) => {
        setSessionId?.(`${chat.sessionId}`);
        setAgentId?.('');

        navigate('/chat');

        setShowSearch(false);
      };

      return <ChatRecordResultItem key={item.sessionId} item={item} highlight={highlight} onClick={handleClick} />;
    },
    [highlight, navigate, setAgentId, setSessionId, setShowSearch]
  );

  const renderItemEmployeeResource = useCallback(
    (tabKey: string, item: any) => {
      const resourceType = resourceSiderTypeByTabKey[tabKey];
      if (!resourceType) {
        return null;
      }

      const resourceItem = normalizeResourceItem(item);
      const drillable = getEmployeeResourceDrillable(tabKey, resourceItem);

      return (
        <ResourceSiderListItem
          key={`${resourceItem.resourceBizType || ''}_${resourceItem.resourceId || resourceItem.resourceCode}`}
          item={resourceItem}
          resourceType={resourceType}
          drillable={drillable}
          renderName={(currentItem) => highlight(currentItem.resourceName)}
          renderDescription={(currentItem) =>
            highlight(currentItem.resourceDesc || currentItem.description || currentItem.resourceBizType || '')
          }
          onClick={(currentItem, currentDrillable) =>
            void handleEmployeeResourceItemClick(tabKey, currentItem, currentDrillable)
          }
          onDoubleClick={() => handleEmployeeResourceDoubleClick(tabKey, resourceItem)}
        />
      );
    },
    [getEmployeeResourceDrillable, handleEmployeeResourceDoubleClick, handleEmployeeResourceItemClick, highlight]
  );

  const renderItemKnowledgeBase = useCallback(
    (item: IKnowledgeBaseItem) => (
      <KnowledgeBaseListItem
        key={item.resourceId}
        item={item}
        onClick={handleKnowledgeBaseItemClick}
        onDoubleClick={handleKnowledgeBaseItemDoubleClick}
      />
    ),
    [handleKnowledgeBaseItemClick, handleKnowledgeBaseItemDoubleClick]
  );

  // 渲染列表
  const renderList = (list: any, renderItem: any, className?: string) => {
    if ((list || []).length === 0) {
      return <SearchEmpty intl={intl} />;
    }
    return <div className={className}>{list.map(renderItem)}</div>;
  };

  const getEmployeeResourceRenderItem = (tabKey: string) =>
    tabKey === 'knowledge' ? renderItemKnowledgeBase : (item: any) => renderItemEmployeeResource(tabKey, item);
  const getEmployeeResourceListClassName = (tabKey: string) => {
    if (tabKey === 'knowledge') {
      return styles.knowledgeResourceList;
    }
    if (resourceSiderTypeByTabKey[tabKey]) {
      return styles.employeeResourceSiderList;
    }
    return undefined;
  };

  // 内容区域
  const renderContent = () => {
    let content = null;
    const employeeResourceTotal = Object.values(employeeResourceResultMap).reduce((sum, list) => sum + list.length, 0);
    const total = digitList.length + result?.sessionList?.length + employeeResourceTotal;
    if (isLoading) {
      return <SearchLoading intl={intl} />;
    }
    if (total === 0) {
      return <SearchEmpty intl={intl} />;
    }
    const comprehensive = intl.formatMessage({ id: 'common.comprehensive' });
    const digitalEmployee = intl.formatMessage({ id: 'common.digitalEmployee' });
    const chatRecord = intl.formatMessage({ id: 'common.chatRecord' });
    if (activeTab === comprehensive) {
      content = (
        <div className={styles.tabContent}>
          <SearchSection
            title={digitalEmployee}
            data={digitList}
            renderItem={renderItemEmployee}
            renderList={renderList}
            viewMoreText={intl.formatMessage({ id: 'common.viewMore' })}
            onViewMore={(title) => setActiveTab(String(title))}
          />
          {visibleEmployeeResourceTabs.map((tab) => (
            <SearchSection
              key={tab.key}
              title={tab.title}
              data={employeeResourceResultMap[tab.key]}
              renderItem={getEmployeeResourceRenderItem(tab.key)}
              renderList={renderList}
              listClassName={getEmployeeResourceListClassName(tab.key)}
              viewMoreText={intl.formatMessage({ id: 'common.viewMore' })}
              onViewMore={(title) => setActiveTab(String(title))}
            />
          ))}
          <SearchSection
            title={chatRecord}
            data={result?.sessionList}
            renderItem={renderItemChat}
            renderList={renderList}
            viewMoreText={intl.formatMessage({ id: 'common.viewMore' })}
            onViewMore={(title) => setActiveTab(String(title))}
          />
        </div>
      );
    }
    if (activeTab === digitalEmployee) {
      content = <div className={styles.tabContent}>{renderList(digitList, renderItemEmployee)}</div>;
    }
    if (activeTab === chatRecord) {
      content = <div className={styles.tabContent}>{renderList(result?.sessionList, renderItemChat)}</div>;
    }
    const activeEmployeeResourceTab = visibleEmployeeResourceTabs.find((tab) => activeTab === tab.title);
    if (activeEmployeeResourceTab) {
      content = (
        <div className={styles.tabContent}>
          <EmployeeResourceContent
            tabKey={activeEmployeeResourceTab.key}
            list={employeeResourceResultMap[activeEmployeeResourceTab.key]}
            currentKnowledgeBase={currentKnowledgeBase}
            activeSiderAgentResourceId={activeSiderAgent.resourceId}
            employeeResourceDrillState={employeeResourceDrillState}
            employeeResourceDrillLoading={employeeResourceDrillLoading}
            intl={intl}
            renderList={renderList}
            renderItemKnowledgeBase={renderItemKnowledgeBase}
            renderItemEmployeeResource={renderItemEmployeeResource}
            onKnowledgeBaseGoBack={handleKnowledgeBaseGoBack}
            onEmployeeResourceGoBack={handleEmployeeResourceGoBack}
          />
        </div>
      );
    }
    return (
      <div className={styles.content} style={{ height: '60vh' }}>
        {content}
      </div>
    );
  };

  const TABS: SearchTabItem[] = useMemo(
    () => [
      { key: '1', title: intl.formatMessage({ id: 'common.comprehensive' }) },
      { key: '2', title: intl.formatMessage({ id: 'common.digitalEmployee' }) },
      { key: '4', title: intl.formatMessage({ id: 'common.chatRecord' }) },

      ...visibleEmployeeResourceTabs.map((tab) => ({
        key: `employeeResource_${tab.key}`,
        title: tab.title,
      })),
    ],
    [intl, visibleEmployeeResourceTabs]
  );

  if (!showSearch) {
    return null;
  }

  return (
    <div
      className={classnames(
        styles.searchContentWrap,
        {
          [styles.absolute]: !displayInModal,
        },
        className
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {displayInModal && (
        <Input
          allowClear
          size="large"
          value={stateKeyword}
          onChange={(e) => setStateKeyword(e.target.value)}
          prefix={<SearchOutlined className={styles.searchIcon} />}
          placeholder={intl.formatMessage({ id: 'layouHeader.search' })}
        />
      )}
      <SearchTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      {/* 内容区域 */}
      {renderContent()}
    </div>
  );
};

export default connect(({ session, loading }: any) => ({
  session,
  loading,
}))(HeaderSearchPage);
