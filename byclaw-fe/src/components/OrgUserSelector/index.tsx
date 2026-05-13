/* eslint-disable eqeqeq */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { Breadcrumb, BreadcrumbProps, Empty, Input, Spin } from 'antd';
import classNames from 'classnames';
import { debounce, get, trim } from 'lodash';
import { useIntl } from '@umijs/max';

import { getOrgTree } from '@/service/orgMgr';
import InfiniteScroll from 'react-infinite-scroll-component';
import AntdIcon from '../AntdIcon';
import withDrag, { DragType } from '../QueryInput/withDrag';
import styles from './index.module.less';
import { findUser } from '@/service/search';
import { getUsersByOrgId } from '@/service/memberMgr';
import useAbortRequest from '@/hooks/useAbortRequest';
import UserInfoModal from './components/UserInfoModal';
import UserInfoListItem from './components/UserInfoListItem';
import { OrgItem, UserItem } from './types';

type OrgUserSelectorProps = {
  className?: string;
  style?: React.CSSProperties;
  mentionRealEmployee?: false | ((item: UserItem) => any);
  onSelect?: (user: UserItem) => void;
  disableChat?: boolean;
  onChatSuccess?: (sessionId: string) => any;
};

const PAGE_SIZE = 20;
const SCROLLABLE_TARGET_ID = `org-user-selector-${Math.random().toString(16).slice(2)}`;

const Draggable = withDrag(DragType.superAssistant);

const OrgUserSelector: React.FC<OrgUserSelectorProps> = (props) => {
  const { onSelect, className, style, disableChat, mentionRealEmployee } = props;
  const { onChatSuccess } = props;
  const [orgList, setOrgList] = useState<OrgItem[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string>('-1');
  const [breadcrumb, setBreadcrumb] = useState<OrgItem[]>([]);
  const [childOrgs, setChildOrgs] = useState<OrgItem[]>([]);
  // 用户分页相关
  const [users, setUsers] = useState<UserItem[]>([]);
  const userPageIndex = useRef(1);
  const [orgListLoading, setOrgListLoading] = useState(false);
  const [userHasMore, setUserHasMore] = useState(true);
  const [userLoading, setUserLoading] = useState(false);
  const searchValue = useRef('');
  const [searchUsers, setSearchUsers] = useState<UserItem[]>([]);
  const searchPageIndex = useRef(1);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);

  const intl = useIntl();

  // 组织树转map，便于查找
  const orgMap = useMemo(() => {
    const map = new Map<string, OrgItem>();
    orgList.forEach((org) => map.set(`${org.orgId}`, org));
    return map;
  }, [orgList]);

  // 获取所有组织
  useEffect(() => {
    setOrgListLoading(true);
    getOrgTree({})
      .then((res: any) => {
        setOrgList(res || []);
      })
      .finally(() => setOrgListLoading(false));
  }, []);

  // 组织下钻
  const drillDown = useCallback(
    (org: OrgItem) => {
      setCurrentOrgId(org.orgId);
      // 计算面包屑
      const pathIds = org.pathCode.split('.');
      const path = pathIds.map((id) => orgMap.get(id)).filter(Boolean) as OrgItem[];
      setBreadcrumb(path);
    },
    [orgMap]
  );

  // 加载当前层级下的组织
  useEffect(() => {
    const children = orgList.filter((o) => o.parentOrgId == currentOrgId);
    setChildOrgs(children);
  }, [currentOrgId, orgList]);

  // 用户分页加载
  const loadMoreUsers = () => {
    if (userLoading) return;
    setUserLoading(true);
    getUsersByOrgId({
      orgId: currentOrgId,
      pageNum: userPageIndex.current,
      pageSize: PAGE_SIZE,
    })
      .then((res: any) => {
        const data = get(res, 'rows', []);
        setUsers((prev) => (userPageIndex.current === 1 ? data : [...prev, ...data]));
        setUserHasMore(data.length === PAGE_SIZE);
        userPageIndex.current += 1;
      })
      .finally(() => setUserLoading(false));
  };

  const qrySearchUsers = useAbortRequest(findUser);

  // 搜索用户分页加载
  const loadMoreSearchUsers = () => {
    setSearchLoading(true);
    qrySearchUsers({
      keyword: searchValue.current,
      pageNum: searchPageIndex.current,
      pageSize: PAGE_SIZE,
    }).then(
      (res: any) => {
        const data = get(res, 'data.rows', []);
        setSearchUsers((prev) => (searchPageIndex.current === 1 ? data : [...prev, ...data]));
        setSearchHasMore(data.length === PAGE_SIZE);
        searchPageIndex.current += 1;
        setSearchLoading(false);
      },
      () => {}
    );
  };

  const refreshOrgUsers = () => {
    setUsers([]);
    setSearchUsers([]);
    userPageIndex.current = 1;
    setUserHasMore(true);
    // 首次加载
    loadMoreUsers();
  };

  useEffect(() => {
    refreshOrgUsers();
  }, [currentOrgId]);

  const handleSearch = (value: string) => {
    searchValue.current = value;
    if (value) {
      setUsers([]);
      setSearchUsers([]);
      searchPageIndex.current = 1;
      setSearchHasMore(true);
      loadMoreSearchUsers();
    } else {
      refreshOrgUsers();
    }
  };

  const handleSearchDebounced = debounce(handleSearch, 300);

  // 面包屑点击
  const handleBreadcrumbClick = (org: OrgItem, idx: number) => {
    setCurrentOrgId(org.orgId);
    setBreadcrumb(breadcrumb.slice(0, idx + 1));
    userPageIndex.current = 1;
    setUsers([]);
    setUserHasMore(true);
  };

  // 渲染组织节点
  const renderOrg = (org: OrgItem) => (
    <div key={`org-${org.orgId}`} className={classNames(styles.item, styles.org)} onClick={() => drillDown(org)}>
      <span className={styles.icon}>
        <AntdIcon type="icon-zuzhitubiao" />
      </span>
      <span className={styles.name}>{org.orgName}</span>
      <span className={styles.arrow}>
        <RightOutlined />
      </span>
    </div>
  );

  // 渲染用户节点
  const renderUser = (user: UserItem) => (
    <Draggable disabled data={user} key={`user-${user.userId}`}>
      <UserInfoModal user={user} disable={!!onSelect}>
        <UserInfoListItem
          user={user}
          disableChat={disableChat}
          onSelect={() => onSelect?.(user)}
          onChatSuccess={onChatSuccess}
          mentionRealEmployee={mentionRealEmployee}
        />
      </UserInfoModal>
    </Draggable>
  );

  const infiniteScrollComp = (() => {
    const isSearchMode = !!searchValue.current;
    const data = isSearchMode ? searchUsers : users;
    const hasMore = isSearchMode ? !!searchHasMore : !!userHasMore;
    const showEmpty = isSearchMode && searchUsers.length === 0 && !searchLoading;
    const loadMore = isSearchMode ? loadMoreSearchUsers : loadMoreUsers;
    const isFirstLoading = data.length === 0 && (searchLoading || userLoading);
    if (isFirstLoading) {
      return <Spin spinning className={styles.spinLoader} />;
    }
    return (
      <InfiniteScroll
        initialScrollY={0}
        dataLength={data.length}
        next={loadMore}
        hasMore={hasMore}
        style={{ overflow: 'visible' }}
        loader={<Spin spinning className={styles.spinLoader} />}
        scrollableTarget={SCROLLABLE_TARGET_ID}
        key={searchValue.current ? 'only-users-list' : 'mix-list'}
      >
        {showEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {data.map(renderUser)}
      </InfiniteScroll>
    );
  })();

  return (
    <div style={style} className={classNames(styles.container, className)}>
      <Input
        allowClear
        suffix={<SearchOutlined onClick={() => handleSearch(searchValue.current)} />}
        placeholder={intl.formatMessage({
          id: 'selectMember.searchPlaceholder',
        })}
        onChange={(e) => {
          searchValue.current = trim(e.target.value);
          handleSearchDebounced(searchValue.current);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSearch(searchValue.current);
          }
        }}
        style={{ marginBottom: 8 }}
        className={styles.search}
      />
      <Spin spinning={orgListLoading && !userLoading} className={styles.orgSpin} />
      {!searchValue.current && (
        <Breadcrumb
          className={styles.breadcrumb}
          items={(() => {
            const items: BreadcrumbProps['items'] = breadcrumb.map((item, idx) => ({
              key: item.orgId,
              title: item.orgName,
              onClick: () => handleBreadcrumbClick(item, idx),
            }));
            if (currentOrgId != '-1') {
              items.unshift({
                key: '-1',
                title: <HomeOutlined />,
                onClick: () => handleBreadcrumbClick({ orgId: '-1' } as OrgItem, -1),
              });
            }
            return items;
          })()}
        />
      )}
      <div className={classNames(styles.list, 'hideThumb')} id={SCROLLABLE_TARGET_ID}>
        {/* 搜索模式：只展示用户，滚动加载 */}
        {searchValue.current ? (
          infiniteScrollComp
        ) : (
          <div key="mix-wrapper">
            {/* 组织区 */}
            {childOrgs.length > 0 && <div key="org-list">{childOrgs.map(renderOrg)}</div>}
            {infiniteScrollComp}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrgUserSelector;
