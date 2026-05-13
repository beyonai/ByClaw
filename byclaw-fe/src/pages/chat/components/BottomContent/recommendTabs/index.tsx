import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Tabs, App, Skeleton } from 'antd';
import classNames from 'classnames';
import { useIntl, useSelector, getLocale } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import AntdIcon from '@/components/AntdIcon';
import { isAdminVip } from '@/utils/auth';
import { deleteTemplate, getTemplateDetail, getTemplateList } from './services';
// @ts-ignore
import tmpBg from './tmp.jpeg';
import styles from './index.module.less';
import { get } from 'lodash';
import TemplateModal from '@/components/ChatLayoutComp/components/CreateTemplate';
import NullableAntdCompWithAnim from '@/components/NullableAntdCompWithAnim';
import useAppStore from '@/models/common/useAppStore';
import { getTemplateTypes } from '@/service/auth';
import { downloadMinIOFileURL } from '@/service/file';

interface ITemplateItem {
  sessionId: string;
  templateTitle: string;
  templateCoverId: string;
  templateType: string;
  originalSessionId: string;

  /** 封面走 dataset 下载时与 directoryPath 配套 */
  coverResourceId?: string | number;
  coverDirectoryPath?: string;
  datasetId?: string | number;
}

function buildTemplateCoverDownloadUrl(item: ITemplateItem): string {
  const resourceId = item.templateCoverId;
  if (!resourceId) {
    return '';
  }
  const q = new URLSearchParams();
  q.set('fileId', String(resourceId));
  return `${downloadMinIOFileURL}?${q.toString()}`;
}

const colorCycle = ['#F0EFFD', '#EAF2FE', '#E9FAF6', '#F5F3ED'];

function GradientIcon({
  children,
}: {
  children: React.ReactElement<SVGPathElement> | React.ReactElement<SVGPathElement>[];
}) {
  const [linearGradientId] = useState(`myGradient_${Math.random().toString(16).slice(2)}`);
  return (
    <span
      className={classNames('anticon', styles.gradientIcon)}
      style={
        {
          '--linear-gradient-url': `url(#${linearGradientId})`,
        } as React.CSSProperties
      }
    >
      <svg
        className="icon"
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        fill="currentColor"
      >
        <defs>
          <linearGradient id={linearGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--stop-color-1)" />
            <stop offset="100%" stopColor="var(--stop-color-2)" />
          </linearGradient>
        </defs>
        {children}
      </svg>
    </span>
  );
}

export default function RecommendTabs() {
  const { EventEmitter } = useGlobal();
  const intl = useIntl();
  const userInfo = useSelector(({ user }) => user.userInfo);
  const { modal, message } = App.useApp();
  const [loadingItems, setLoadingItems] = useState<React.Key[]>([]);
  const [templateList, setTemplateList] = useState<ITemplateItem[]>([]);
  const [tabList, setTabList] = useState([]); // 模板分类列表
  const [currentTab, setCurrentTab] = useState(''); // 当前选中的分类
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [imageErrors, setImageErrors] = useState<string[]>([]);

  const { setLoginModalOpen } = useAppStore();
  const local = getLocale();

  const [templateModalProps, setTemplateModalProps] = useState<{
    open: boolean;
    sessionId: string;
  }>({
    open: false,
    sessionId: '',
  });

  // 获取模板数据
  const fetchTemplateData = useCallback(
    async (tabKey: string) => {
      setIsLoadingList(true);
      setTemplateList([]);
      if (!tabKey) {
        return;
      }
      try {
        const res = await getTemplateList({
          templateTypes: tabKey,
          terminals: isAdminVip(userInfo) ? ['ALL', 'PC', 'APP'] : ['ALL', 'PC'],
        });

        setTemplateList((res as any)?.list || []);
      } catch (error) {
        console.error('获取模板数据失败:', error);
      } finally {
        setIsLoadingList(false);
      }
    },
    [userInfo]
  );

  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);

  useEffect(() => {
    fetchTemplateData(currentTab);
  }, [currentTab, fetchTemplateData]);

  // 监听userInfo变化，当用户登录后重新加载失败的图片
  useEffect(() => {
    if (userInfo) {
      // 用户登录后，清除所有图片错误状态，让图片重新加载
      setImageErrors([]);
    }
  }, [userInfo]);

  const handleEditTemplate = useCallback((item: ITemplateItem) => {
    setTemplateModalProps({ open: true, sessionId: item.sessionId });
  }, []);

  const checkLogin = useCallback(() => {
    if (!userInfo) {
      setLoginModalOpen(true);
      return false;
    }
    return true;
  }, [userInfo, setLoginModalOpen]);

  const makeSameStyle = useCallback(
    async (item: ITemplateItem) => {
      if (loadingItems.includes(item.sessionId)) {
        return;
      }
      if (!checkLogin()) {
        return;
      }
      setLoadingItems((prev) => [...prev, item.sessionId]);
      try {
        const res: any = await getTemplateDetail({
          sessionId: item.sessionId,
        });
        const templateConfig = get(res, 'templateExtInfo.templateConfig');
        EventEmitter.emit('queryInput-set-schema', JSON.parse(templateConfig));
      } catch (error) {
        console.error('做同款失败:', error);
      } finally {
        setLoadingItems((prev) => prev.filter((id) => id !== item.sessionId));
      }
    },
    [loadingItems, checkLogin]
  );

  const handleImageError = useCallback((sessionId: string) => {
    setImageErrors((prev) => [...prev, sessionId]);
  }, []);

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
    [currentTab, intl, modal, message]
  );

  useEffect(() => {
    // 模板分类列表
    getTemplateTypes({
      standType: 'TEMPLATE_TYPE',
    }).then((data = []) => {
      setTabList(data || []);
      if (data?.length) {
        setCurrentTab(data?.[0]?.paramValue);
      }
    });
  }, []);

  return (
    <div className={styles.tabsWrap} id="guideStep3-1">
      <Tabs
        centered
        activeKey={currentTab}
        onChange={setCurrentTab}
        items={(tabList || [])?.map?.((tab: { paramValue: string; paramName: string; paramEnName?: string }) => ({
          key: tab.paramValue,
          label: isEN ? tab.paramEnName || tab.paramName : tab.paramName,
          children: (
            <div className={styles.cardsGrid}>
              {isLoadingList &&
                // 显示3个骨架屏
                Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton.Node active key={`skeleton-${index}`} style={{ width: '100%', height: 128 }} />
                ))}
              {templateList.map((item, index) => {
                const itemKey = `${tab.paramValue}-${item.sessionId}`;
                const coverSrc = buildTemplateCoverDownloadUrl(item);
                return (
                  <div
                    key={itemKey}
                    className={styles.cardItem}
                    style={{ backgroundColor: colorCycle[index % colorCycle.length] }}
                  >
                    <div className={styles.cardTitle}>{item.templateTitle}</div>
                    <div className={styles.poster}>
                      <img
                        // 这里要加个key，不然切换登录状态后，不会触发onError
                        key={`${item.sessionId}-${imageErrors.includes(item.sessionId) ? 'error' : 'normal'}-img`}
                        style={{ display: 'none' }}
                        src={coverSrc || undefined}
                        alt="poster"
                        onError={() => handleImageError(item.sessionId)}
                      />
                      <div
                        className={styles.posterImage}
                        style={{
                          backgroundImage: imageErrors.includes(item.sessionId)
                            ? `url(${tmpBg})`
                            : coverSrc
                              ? `url(${coverSrc})`
                              : `url(${tmpBg})`,
                        }}
                      />
                    </div>
                    <div className={styles.mask} />
                    {isAdminVip(userInfo) && (
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'edit',
                              label: intl.formatMessage({ id: 'chat.recommendTabs.editTemplate' }),
                            },
                            {
                              key: 'delete',
                              label: intl.formatMessage({ id: 'chat.recommendTabs.deleteTemplate' }),
                            },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'edit') {
                              handleEditTemplate(item);
                            } else if (key === 'delete') {
                              handleDeleteTemplate(item);
                            }
                          },
                        }}
                        placement="bottomLeft"
                        trigger={['hover']}
                        disabled={loadingItems.includes(item.sessionId)}
                      >
                        <Button
                          size="small"
                          loading={loadingItems.includes(item.sessionId)}
                          className={styles.editBtn}
                          icon={<AntdIcon type="icon-a-Editbianji" />}
                          onClick={() => handleEditTemplate(item)}
                        />
                      </Dropdown>
                    )}
                    <div className={classNames(styles.cardBtns)}>
                      <Button
                        size="small"
                        className={styles.gradientBtn}
                        loading={loadingItems.includes(item.sessionId)}
                        icon={
                          <GradientIcon>
                            <path d="M580.16 50.944a38.464 38.464 0 0 1 55.616 34.368V193.92l200.384-100.224a38.464 38.464 0 0 1 55.616 34.368v597.312a38.528 38.528 0 0 1-21.248 34.368l-426.624 213.312a38.464 38.464 0 0 1-55.616-34.304V830.08l-200.384 100.224A38.4 38.4 0 0 1 132.288 896V298.624a38.4 38.4 0 0 1 21.184-34.304L580.16 50.944zM465.088 365.056v511.424l349.824-174.912V190.144L465.088 365.056z m-256-42.688v511.424l179.2-89.6V341.312a38.4 38.4 0 0 1 21.184-34.304l149.44-74.752V147.456L209.088 322.368z" />
                          </GradientIcon>
                        }
                        onClick={() => makeSameStyle(item)}
                      >
                        <span className={styles.gradientText}>
                          {intl.formatMessage({ id: 'chat.recommendTabs.makeSameStyle' })}
                        </span>
                      </Button>
                      <Button
                        size="small"
                        icon={<AntdIcon type="icon-a-Replay-musiczhongxinbofang" />}
                        onClick={() => {
                          if (!checkLogin()) {
                            return;
                          }
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
                        }}
                      >
                        <span className={styles.gradientText}>
                          {intl.formatMessage({ id: 'chat.recommendTabs.viewReplay' })}
                        </span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        }))}
      />
      <NullableAntdCompWithAnim open={templateModalProps.open}>
        <TemplateModal
          {...templateModalProps}
          onClose={() => {
            setTemplateModalProps({ open: false, sessionId: '' });
            fetchTemplateData(currentTab);
          }}
        />
      </NullableAntdCompWithAnim>
    </div>
  );
}
