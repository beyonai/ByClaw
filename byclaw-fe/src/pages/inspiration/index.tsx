import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Input, Row, Col, Skeleton, Tabs, Tag } from 'antd';
import { useIntl, useSelector, getLocale, useNavigate } from '@umijs/max';
import {
  SearchOutlined,
  PictureOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
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

const ALL_CATEGORY_KEY = '__ALL__';

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
  const { EventEmitter, setSessionId } = useGlobal();
  const intl = useIntl();
  const userInfo = useSelector(({ user }) => user.userInfo);
  const { modal, message } = App.useApp();
  const { setLoginModalOpen } = useAppStore();
  const local = getLocale();
  const navigate = useNavigate();

  const [templateList, setTemplateList] = useState<ITemplateItem[]>([]);
  const [typeList, setTypeList] = useState<ITemplateTabItem[]>([]);
  const [currentTab, setCurrentTab] = useState<string>(ALL_CATEGORY_KEY);
  const [isLoading, setIsLoading] = useState(false);
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loadingItems, setLoadingItems] = useState<React.Key[]>([]);

  const isEN = useMemo(() => local.includes('en'), [local]);

  // 将模板的 type 编码映射为分类名称（typeList 来自 getTemplateTypes），匹配不到时回退显示原值。
  const getTypeName = useCallback(
    (typeValue: string) => {
      const matched = typeList.find((item) => `${item.paramValue}` === `${typeValue}`);
      if (!matched) return typeValue;
      return isEN ? matched.paramEnName || matched.paramName : matched.paramName;
    },
    [typeList, isEN]
  );

  const tabList = useMemo(() => {
    const allCategory: ITemplateTabItem = {
      paramValue: ALL_CATEGORY_KEY,
      paramName: intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' }),
      paramEnName: 'All',
    };
    return [allCategory, ...typeList];
  }, [typeList, intl]);

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
        const params: Record<string, any> = {
          terminals: isAdminVip(userInfo) ? ['ALL', 'PC', 'APP'] : ['ALL', 'PC'],
        };
        if (tabKey !== ALL_CATEGORY_KEY) {
          params.templateTypes = tabKey;
        }
        if (searchText) {
          params.keywords = searchText;
        }
        const res = await getTemplateList(params);
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
      setTypeList(next);
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
        const schema = JSON.parse(templateConfig);
        // 打开新的 chat 会话并载入模板 schema，由 chat 页面在输入框挂载后设置（与推荐回放做同款一致）。
        setSessionId?.('');
        navigate('/chat', {
          state: {
            keepSiderActiveKey: 'agent',
            from: 'inspiration',
            templateSchema: {
              sessionId: item.sessionId,
              schema,
            },
          },
        });
      } catch (error) {
        console.error('做同款失败:', error);
      } finally {
        setLoadingItems((prev) => prev.filter((id) => id !== item.sessionId));
      }
    },
    [loadingItems, checkLogin, navigate, setSessionId]
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

  const tabBarExtraContent = (
    <div className={styles.rightTools}>
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
  );

  const renderCardList = () => {
    if (isLoading) {
      return (
        <Row gutter={[20, 20]}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Col span={6} key={`skeleton-${index}`}>
              <div className={styles.card}>
                <div className={styles.cardCover}>
                  <Skeleton.Node active style={{ width: '100%', height: 180, borderRadius: 0 }} />
                </div>
                <div className={styles.cardInfo}>
                  <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 1, width: '40%' }} />
                </div>
              </div>
            </Col>
          ))}
        </Row>
      );
    }

    if (templateList.length === 0) {
      return <Empty className={styles.empty} description={intl.formatMessage({ id: 'inspiration.empty' })} />;
    }

    return (
      <Row gutter={[20, 20]}>
        {templateList.map((item) => {
          const coverSrc = buildCoverUrl(item);
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
                    <Tag className={styles.typeTag}>{getTypeName(item.templateType)}</Tag>
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
    );
  };

  return (
    <div className={styles.page}>
      <Tabs
        className={styles.tabs}
        activeKey={currentTab}
        tabBarExtraContent={tabBarExtraContent}
        items={tabList.map((tab) => ({
          label: isEN ? tab.paramEnName || tab.paramName : tab.paramName,
          key: tab.paramValue,
        }))}
        onChange={(key) => setCurrentTab(key)}
      />
      <div className={styles.body}>{renderCardList()}</div>
    </div>
  );
};

export default Inspiration;
