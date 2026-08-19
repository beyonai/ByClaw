import React, { useCallback, useEffect, useState } from 'react';
import { App, Button, Empty, Input, Row, Col, Skeleton, Tag } from 'antd';
import { useIntl, useSelector, getLocale } from '@umijs/max';
import {
  SearchOutlined,
  StarFilled,
  PictureOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import classNames from 'classnames';
import { get } from 'lodash';

import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
import {
  getTemplateList,
  getTemplateDetail,
  deleteTemplate,
} from '@/pages/chat/components/BottomContent/recommendTabs/services';
import { getTemplateTypes } from '@/service/auth';
import { downloadMinIOFileURL } from '@/service/file';
import { isAdminVip } from '@/utils/auth';

import styles from './index.module.less';

interface ITemplateItem {
  sessionId: string;
  templateTitle: string;
  templateCoverId: string;
  templateType: string;
  originalSessionId: string;
  coverResourceId?: string | number;
  coverDirectoryPath?: string;
  datasetId?: string | number;
}

interface ITemplateTabItem {
  paramValue: string;
  paramName: string;
  paramEnName?: string;
}

function uniqueTemplateTabs(data: ITemplateTabItem[] = []) {
  const tabMap = new Map<string, ITemplateTabItem>();
  data.forEach((item) => {
    if (item?.paramValue && !tabMap.has(item.paramValue)) {
      tabMap.set(item.paramValue, item);
    }
  });
  return Array.from(tabMap.values());
}

function buildCoverUrl(item: ITemplateItem): string {
  const resourceId = item.templateCoverId;
  if (!resourceId) return '';
  const q = new URLSearchParams();
  q.set('fileId', String(resourceId));
  return `${downloadMinIOFileURL}?${q.toString()}`;
}

const Inspiration: React.FC = () => {
  const { EventEmitter } = useGlobal();
  const intl = useIntl();
  const userInfo = useSelector(({ user }) => user.userInfo);
  const { modal, message } = App.useApp();
  const { setLoginModalOpen } = useAppStore();
  const local = getLocale();

  const [templateList, setTemplateList] = useState<ITemplateItem[]>([]);
  const [tabList, setTabList] = useState<ITemplateTabItem[]>([]);
  const [currentTab, setCurrentTab] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [loadingItems, setLoadingItems] = useState<React.Key[]>([]);

  const isEN = React.useMemo(() => local.includes('en'), [local]);

  const checkLogin = useCallback(() => {
    if (!userInfo) {
      setLoginModalOpen(true);
      return false;
    }
    return true;
  }, [userInfo, setLoginModalOpen]);

  const fetchTemplates = useCallback(
    async (tabKey: string, searchText = '') => {
      setIsLoading(true);
      try {
        const res = await getTemplateList({
          templateTypes: tabKey,
          keywords: searchText || undefined,
          terminals: isAdminVip(userInfo) ? ['ALL', 'PC', 'APP'] : ['ALL', 'PC'],
        });
        setTemplateList((res as any)?.list || []);
      } catch (error) {
        console.error('获取灵感数据失败:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [userInfo]
  );

  useEffect(() => {
    getTemplateTypes({ standType: 'TEMPLATE_TYPE' }).then((data = []) => {
      const next = uniqueTemplateTabs(data || []);
      setTabList(next);
      if (next.length) {
        setCurrentTab(next[0]?.paramValue);
      }
    });
  }, []);

  useEffect(() => {
    if (currentTab) {
      fetchTemplates(currentTab, keyword);
    }
  }, [currentTab, keyword, fetchTemplates]);

  useEffect(() => {
    if (userInfo) {
      setImageErrors([]);
    }
  }, [userInfo]);

  const handleSearch = useCallback(() => {
    if (currentTab) {
      fetchTemplates(currentTab, keyword);
    }
  }, [currentTab, keyword, fetchTemplates]);

  const handleImageError = useCallback((sessionId: string) => {
    setImageErrors((prev) => [...prev, sessionId]);
  }, []);

  const handleMakeSameStyle = useCallback(
    async (item: ITemplateItem) => {
      if (loadingItems.includes(item.sessionId)) return;
      if (!checkLogin()) return;
      setLoadingItems((prev) => [...prev, item.sessionId]);
      try {
        const res: any = await getTemplateDetail({ sessionId: item.sessionId });
        const templateConfig = get(res, 'templateExtInfo.templateConfig');
        EventEmitter.emit('queryInput-set-schema', JSON.parse(templateConfig));
      } catch (error) {
        console.error('做同款失败:', error);
      } finally {
        setLoadingItems((prev) => prev.filter((id) => id !== item.sessionId));
      }
    },
    [loadingItems, checkLogin, EventEmitter]
  );

  const handleViewReplay = useCallback(
    (item: ITemplateItem) => {
      if (!checkLogin()) return;
      EventEmitter.emit('beyond-fullabsolute-driver-open-type', {
        drawerType: 'replaytmplate',
        canClose: false,
      });
      EventEmitter.emit('beyond-fullabsolute-driver-message', {
        sessionInfo: {
          sessionId: item.sessionId,
          sessionName: item.templateTitle,
        },
      });
    },
    [checkLogin, EventEmitter]
  );

  const handleDeleteTemplate = useCallback(
    (item: ITemplateItem) => {
      modal.confirm({
        title: intl.formatMessage({ id: 'chat.recommendTabs.deleteTemplateTitle' }),
        content: intl.formatMessage({ id: 'chat.recommendTabs.deleteTemplateContent' }),
        onOk: async () => {
          setLoadingItems((prev) => [...prev, item.sessionId]);
          try {
            await deleteTemplate(item.sessionId);
            message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
            setTemplateList((prev) => prev.filter((o) => o.sessionId !== item.sessionId));
          } catch (error) {
            console.error('删除模板失败', error);
          }
          setLoadingItems((prev) => prev.filter((id) => id !== item.sessionId));
          return true;
        },
      });
    },
    [intl, modal, message]
  );

  const toggleFavorite = useCallback((sessionId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const filteredList = React.useMemo(() => {
    if (!showFavoritesOnly) return templateList;
    return templateList.filter((item) => favorites.has(item.sessionId));
  }, [templateList, favorites, showFavoritesOnly]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>{intl.formatMessage({ id: 'inspiration.title' })}</h2>
        <div className={styles.subtitle}>{intl.formatMessage({ id: 'inspiration.subtitle' })}</div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {tabList.map((tab) => {
            const active = currentTab === tab.paramValue;
            const label = isEN ? tab.paramEnName || tab.paramName : tab.paramName;
            return (
              <button
                key={tab.paramValue}
                type="button"
                className={classNames(styles.tabBtn, active && styles.tabBtnActive)}
                onClick={() => setCurrentTab(tab.paramValue)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className={styles.rightTools}>
          <button
            type="button"
            className={classNames(styles.favBtn, showFavoritesOnly && styles.favBtnActive)}
            onClick={() => setShowFavoritesOnly((v) => !v)}
          >
            <StarFilled />
            <span>{intl.formatMessage({ id: 'inspiration.favorites' })}</span>
          </button>
          <Input
            className={styles.searchInput}
            placeholder={intl.formatMessage({ id: 'inspiration.searchPlaceholder' })}
            prefix={<SearchOutlined />}
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
          />
        </div>
      </div>

      <div className={styles.body}>
        {isLoading ? (
          <Row gutter={[20, 20]}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Col span={6} key={`skeleton-${index}`}>
                <div className={styles.cardSkeleton}>
                  <Skeleton.Image active style={{ width: '100%', height: 180 }} />
                  <Skeleton active paragraph={{ rows: 2 }} />
                </div>
              </Col>
            ))}
          </Row>
        ) : filteredList.length === 0 ? (
          <Empty className={styles.empty} description={intl.formatMessage({ id: 'inspiration.empty' })} />
        ) : (
          <Row gutter={[20, 20]}>
            {filteredList.map((item) => {
              const coverSrc = buildCoverUrl(item);
              const isFav = favorites.has(item.sessionId);
              return (
                <Col span={6} key={item.sessionId}>
                  <div className={styles.card}>
                    <div className={styles.cardCover}>
                      <img
                        key={`${item.sessionId}-${imageErrors.includes(item.sessionId) ? 'error' : 'normal'}-img`}
                        src={imageErrors.includes(item.sessionId) ? '' : coverSrc}
                        alt={item.templateTitle}
                        onError={() => handleImageError(item.sessionId)}
                      />
                      <div
                        className={styles.coverFallback}
                        style={{ display: imageErrors.includes(item.sessionId) || !coverSrc ? 'flex' : 'none' }}
                      >
                        <PictureOutlined />
                      </div>
                      <button
                        type="button"
                        className={classNames(styles.favIcon, isFav && styles.favIconActive)}
                        onClick={() => toggleFavorite(item.sessionId)}
                      >
                        <StarFilled />
                      </button>
                      {isAdminVip(userInfo) && (
                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => handleDeleteTemplate(item)}
                            title={intl.formatMessage({ id: 'chat.recommendTabs.deleteTemplate' })}
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={styles.cardInfo}>
                      <div className={styles.cardTitle} title={item.templateTitle}>
                        {item.templateTitle}
                      </div>
                      <div className={styles.cardFooter}>
                        <Tag className={styles.typeTag}>{item.templateType}</Tag>
                      </div>
                    </div>
                    <div className={styles.cardOverlay}>
                      <Button
                        className={styles.overlayBtn}
                        loading={loadingItems.includes(item.sessionId)}
                        onClick={() => handleMakeSameStyle(item)}
                        icon={<ThunderboltOutlined />}
                      >
                        {intl.formatMessage({ id: 'inspiration.makeSameStyle' })}
                      </Button>
                      <Button
                        className={styles.overlayBtn}
                        loading={loadingItems.includes(item.sessionId)}
                        onClick={() => handleViewReplay(item)}
                        icon={<ReloadOutlined />}
                      >
                        {intl.formatMessage({ id: 'inspiration.viewReplay' })}
                      </Button>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
      </div>
    </div>
  );
};

export default Inspiration;
