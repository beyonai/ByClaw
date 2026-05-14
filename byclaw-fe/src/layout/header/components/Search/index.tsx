import React, { useCallback, useEffect, useState, useMemo } from 'react';
// @ts-ignore
import { connect, useDispatch, useIntl, useNavigate } from '@umijs/max';
import { Badge, Empty, Input, message, Spin } from 'antd';
import { debounce } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { canJumpAgent, agentHandler, getAgentChatAvatar, getAgentPath, getAvatarUrl } from '@/utils/agent';
import { escapeRegExp } from '@/utils/tools';
import classnames from 'classnames';
import { getSearchList } from '@/service/layout';
import useGlobal from '@/hooks/useGlobal';
import useTracker from '@/hooks/useTracker';

import RenderRightTop from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import styles from './index.module.less';
import { SearchOutlined } from '@ant-design/icons';

interface HeaderSearchPageProps {
  keyword?: string;
  setShowSearch: (show: boolean) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  showSearch: boolean;
  displayInModal?: boolean;
}

const HeaderSearchPage = (props: HeaderSearchPageProps) => {
  const { keyword: ctrlKeyword, setShowSearch, onMouseEnter, onMouseLeave, showSearch, displayInModal } = props;
  const intl = useIntl();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { trackerEmployeeClick } = useTracker();

  const { setAgentId, setSessionId } = useGlobal();

  const cancelTokenQKRef = React.useRef<AbortController>(new AbortController());
  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [stateKeyword, setStateKeyword] = useState(ctrlKeyword || '');

  const keyword = ctrlKeyword || stateKeyword;

  // 当前tab
  const [activeTab, setActiveTab] = useState(intl.formatMessage({ id: 'common.comprehensive' }));

  // 搜索结果
  const [result, setResult] = useState({
    digitList: [], // 数字员工的列表
    userList: [], // 企业员工的列表
    sessionList: [], // 会话列表
  });

  const digitList = useMemo(
    () =>
      (result?.digitList || []).map((item) => {
        return agentHandler(item);
      }),
    [result?.digitList]
  );

  // 模糊搜索（keyword 为空时也请求后端，用于首次打开展示默认列表）
  const myGetSearchList = useCallback(
    debounce((myKeyword: string) => {
      if (cancelTokenQKRef.current) {
        cancelTokenQKRef.current.abort();
      }

      cancelTokenQKRef.current = new AbortController();

      setIsLoading(true);

      getSearchList(
        {
          pageSize: 20,
          pageIndex: 1,
          type: 'all',
          keyword: myKeyword.trim(),
        },
        cancelTokenQKRef.current
      )
        .then((response) => {
          setResult(response);
          setIsLoading(false);
        })
        .catch((err) => {
          if (!err || err.name !== 'CanceledError') {
            setIsLoading(false);
          }
        });
    }, 300),
    [dispatch]
  );

  useEffect(() => {
    if (!showSearch) {
      return;
    }
    myGetSearchList(keyword);
  }, [keyword, showSearch, myGetSearchList]);

  /** 弹窗首次打开时立即拉取，避免仅依赖 debounce 的首帧延迟 */
  useEffect(() => {
    if (!showSearch) {
      return;
    }
    myGetSearchList.flush();
  }, [showSearch, myGetSearchList]);

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
    (item: any) => (
      <div
        className={styles.itemBox}
        key={item.id}
        onClick={() => {
          const isCanJump = canJumpAgent(item);
          if (!isCanJump) {
            message.destroy();
            message.error(intl.formatMessage({ id: 'headerSearch.applyPermissionTip' }));
            return;
          }

          trackerEmployeeClick(item, 'siderAgentRedirect');

          dispatch({
            type: 'chat/save',
            payload: {
              curSession: {},
            },
          });
          setShowSearch(false);
          setAgentId?.(item.id);
          navigate(getAgentPath(item));
        }}
      >
        <div className={styles.itemEmployeeImgBox}>
          <img className={styles.itemEmployeeImg} src={getAvatarUrl(item.avatar)} alt="" />
        </div>
        <div className={styles.itemContent}>
          <div className={styles.renderRightTop}>
            <RenderRightTop employee={item} />
          </div>
          <span className={styles.itemTitle}>{highlight(item.name)}</span>
          <span className={styles.itemDesc}>{highlight(item.resourceDesc)}</span>
        </div>
      </div>
    ),
    [dispatch, highlight]
  );

  // 渲染聊天记录
  const renderItemChat = useCallback(
    (item: any) => (
      <div
        className={styles.itemBox}
        key={item.sessionId}
        onClick={() => {
          setSessionId?.(`${item.sessionId}`);
          setAgentId?.('');

          navigate('/chat');

          setShowSearch(false);
        }}
      >
        <div className={styles.avatarWrapper}>
          <Badge count={item.unread} size="small">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: `var(--${PREFIX_NAME}-${item.theme}-2)`,
              }}
            >
              {getAgentChatAvatar(item.avatar)}
            </div>
          </Badge>
        </div>
        <div className={styles.itemContent}>
          <span className={styles.itemTitle}>{highlight(item.sessionName)}</span>
          <span className={styles.itemDesc}>{highlight(item.sessionContent || item.createTime)}</span>
        </div>
      </div>
    ),
    [dispatch, highlight]
  );

  const emptyStyle = {
    height: '60vh',
  };

  // 渲染空状态
  const renderEmpty = () => (
    <div className={styles.empty} style={emptyStyle}>
      <Empty
        image="https://gw.alipayobjects.com/zos/antfincdn/ZHrcdLPrvN/empty.svg"
        imageStyle={{ height: 80 }}
        description={<span className={styles.noContent}>{intl.formatMessage({ id: 'workCenter.noContent' })}</span>}
      />
    </div>
  );

  // 渲染列表
  const renderList = (list: any, renderItem: any) => {
    if ((list || []).length === 0) {
      return renderEmpty(intl.formatMessage({ id: 'common.noData' }));
    }
    return <div>{list.map(renderItem)}</div>;
  };

  // 渲染分组
  const renderSection = (title: any, data: any, renderItem: any) =>
    (data || []).length ? (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>{title}</span>
          {data.length > 3 && (
            <div
              className={styles.sectionMore}
              onClick={() => {
                setActiveTab(title);
              }}
            >
              <span className={styles.sectionMorespan}>{intl.formatMessage({ id: 'common.viewMore' })}</span>
              <AntdIcon type="icon-a-Rightyou" className={styles.sectionMoreImg} />
            </div>
          )}
        </div>
        <div>{renderList(data.slice(0, 3), renderItem)}</div>
      </div>
    ) : null;

  // 渲染加载状态
  const renderLoading = () => {
    return (
      <div className={styles.empty} style={emptyStyle}>
        <Spin spinning={isLoading} tip={intl.formatMessage({ id: 'common.querying' })} size="large" />
      </div>
    );
  };

  // 内容区域
  const renderContent = () => {
    let content = null;
    const total = digitList.length + result?.userList?.length + result?.sessionList?.length;
    if (isLoading) {
      return renderLoading();
    }
    if (total === 0) {
      return renderEmpty(intl.formatMessage({ id: 'common.noData' }));
    }
    const comprehensive = intl.formatMessage({ id: 'common.comprehensive' });
    const digitalEmployee = intl.formatMessage({ id: 'common.digitalEmployee' });
    const chatRecord = intl.formatMessage({ id: 'common.chatRecord' });
    if (activeTab === comprehensive) {
      content = (
        <div className={styles.tabContent}>
          {renderSection(digitalEmployee, digitList, renderItemEmployee)}
          {renderSection(chatRecord, result?.sessionList, renderItemChat)}
        </div>
      );
    }
    if (activeTab === digitalEmployee) {
      content = <div className={styles.tabContent}>{renderList(digitList, renderItemEmployee)}</div>;
    }
    if (activeTab === chatRecord) {
      content = <div className={styles.tabContent}>{renderList(result?.sessionList, renderItemChat)}</div>;
    }
    return (
      <div className={styles.content} style={{ height: '60vh' }}>
        {content}
      </div>
    );
  };

  const TABS = useMemo(
    () => [
      { key: '1', title: intl.formatMessage({ id: 'common.comprehensive' }) },
      { key: '2', title: intl.formatMessage({ id: 'common.digitalEmployee' }) },
      { key: '4', title: intl.formatMessage({ id: 'common.chatRecord' }) },
    ],
    [intl]
  );

  if (!showSearch) {
    return null;
  }

  return (
    <div
      className={classnames(styles.searchContentWrap, {
        [styles.absolute]: !displayInModal,
      })}
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
      <div className={styles.searchTabs}>
        {TABS.map((tab) => (
          <span
            key={tab.key}
            className={classnames(styles.searchTab, activeTab === tab.title && styles.activeTab)}
            onClick={() => setActiveTab(tab.title)}
          >
            {tab.title}
          </span>
        ))}
      </div>
      {/* 内容区域 */}
      {renderContent()}
    </div>
  );
};

export default connect(({ session, loading }: any) => ({
  session,
  loading,
}))(HeaderSearchPage);
