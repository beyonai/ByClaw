/* eslint-disable no-nested-ternary */
/* eslint-disable consistent-return */
/* eslint-disable no-empty */
/* eslint-disable react/jsx-indent-props */
/* eslint-disable react/jsx-indent */
/* eslint-disable indent */
import { useIntl } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Button, Dropdown, Empty, Input, message, Modal, Pagination, Spin, Typography, Form, notification } from 'antd';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { pick } from 'lodash';
import dayjs from 'dayjs';
import AntdIcon from '@/components/AntdIcon';
import { downloadResourceFile } from '@/service/file';
import { downloadFile } from '@/utils/file';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { deleteShowcase, getShowcaseList, renameShowcase } from '@/service/showcase';
import MessagesModal from './components/Messages';
import KnowledgeBaseModal from '@/components/KnowledgeBaseModal';
import { Animated } from '@/components/Animated';
import ShareSelect from '@/components/ChatLayoutComp/components/MultiChoices/components/ShareSelect';

import styles from './index.module.less';
import useLocateMessage from '@/hooks/useLocateMessage';
import { fileIconMap as typeIconMap } from '@/constants/icon';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

interface ShowcaseListResponse {
  code: number;
  data?: {
    list?: any[];
    total?: number;
    pageNum?: number;
    pageSize?: number;
  };
}

const CARD_BODY_ICON_SIZE = 32;

const AchievementSpacePage: React.FC = () => {
  const intl = useIntl();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableData, setTableData] = useState<any[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | Blob>();
  const [previewMeta, setPreviewMeta] = useState<{ name?: string; type?: string }>({});
  const [locateMsgLoading, setLocateMsgLoading] = useState(false);

  const [chatId, setChatId] = useState('');
  const [saveKnowledgeVisible, setSaveKnowledgeVisible] = useState(false);
  const [pendingSaveRecord, setPendingSaveRecord] = useState<any>();
  const [imageUrlMap, setImageUrlMap] = useState<Record<string, string>>({});
  const [renameVisible, setRenameVisible] = useState(false);
  const [collectRecord, setCollectRecord] = useState<any>();
  const [renameForm] = Form.useForm();
  const [renameFileExtension, setRenameFileExtension] = useState<string>('');

  const [sessionSelectOpen, setSessionSelectOpen] = useState(false);

  const [notificationMessage, contextHolder] = notification.useNotification();

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await getDcSystemConfigListByStandType({
          standType: 'ACHIEVEMENT_SPACE_TYPE',
        });
        const categoryOptions = Array.isArray(response) ? response : [];
        const allCategories = categoryOptions.filter((item) => item?.paramValue === 'all');
        const otherCategories = categoryOptions.filter((item) => item?.paramValue !== 'all');
        setCategories([...allCategories, ...otherCategories]);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('获取会话空间分类失败', error);
      }
    };

    fetchCategories();
  }, [intl]);

  const handleSearch = useCallback(
    (value?: string) => {
      const target = (value ?? searchInput).trim();
      setKeyword(target);
    },
    [searchInput]
  );
  const typeKey = useCallback((record: any) => {
    let raw: string = record.type;
    if (['text', 'record', 'image', 'ppt'].includes(record.type)) {
      raw = record.name.split('.').pop();
    }
    const normalized = raw.toString().toLowerCase();
    if (['excel', 'xlsx'].includes(normalized)) return 'xlsx';
    return normalized || 'other';
  }, []);

  const loadShowcaseList = useCallback(
    async ({ targetPage, targetSize }: { targetPage?: number; targetSize?: number } = {}) => {
      const currentPage = targetPage ?? pageNum;
      const currentSize = targetSize ?? pageSize;
      setTableLoading(true);
      try {
        const params: Record<string, any> = {
          type: activeCategory || 'all',
          pageNum: currentPage,
          pageSize: currentSize,
        };
        if (keyword) {
          params.keyword = keyword;
        }
        const response: ShowcaseListResponse | undefined = await getShowcaseList(params);

        if (response?.code !== 0) {
          message.error(intl.formatMessage({ id: 'common.requestFailed' }));
          return;
        }

        const data =
          response && typeof response === 'object' && 'list' in response
            ? (response as ShowcaseListResponse['data'])
            : (response as ShowcaseListResponse)?.data ?? {};
        const rows = Array.isArray(data?.list) ? data.list : [];
        const totalCount = data?.total ?? rows.length;
        const responsePageNum = data?.pageNum ?? currentPage;
        const responsePageSize = data?.pageSize ?? currentSize;

        setTableData(rows);
        setTotal(Number(totalCount) || 0);
        setPageNum(responsePageNum);
        setPageSize(responsePageSize);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('获取成果列表失败', error);
        message.error(intl.formatMessage({ id: 'common.requestFailed' }));
      } finally {
        setTableLoading(false);
      }
    },
    [activeCategory, intl, keyword, pageNum, pageSize]
  );

  const dropdownItems: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'detail',
        icon: <AntdIcon style={{ fontSize: 16 }} type="icon-a-Preview-openyulan-dakai" />,
        label: intl.formatMessage({ id: 'achievementSpace.dropdown.detail' }),
      },
      {
        key: 'download',
        icon: <AntdIcon style={{ fontSize: 16 }} type="icon-a-Downloadxiazai" />,
        label: intl.formatMessage({ id: 'achievementSpace.dropdown.download' }),
      },
      {
        key: 'save',
        icon: <AntdIcon style={{ fontSize: 16 }} type="icon-a-Savebaocun" />,
        label: intl.formatMessage({ id: 'achievementSpace.dropdown.save' }),
      },
      {
        key: 'share',
        icon: <AntdIcon type="icon-a-Share-twofenxiang21" style={{ fontSize: 16 }} />,
        label: intl.formatMessage({ id: 'common.share' }),
      },
      {
        key: 'rename',
        icon: <AntdIcon style={{ fontSize: 16 }} type="icon-a-Editorbianji" />,
        label: intl.formatMessage({ id: 'common.rename' }),
      },
      {
        key: 'delete',
        icon: <AntdIcon style={{ fontSize: 16 }} type="icon-a-Deleteshanchu" />,
        label: intl.formatMessage({ id: 'achievementSpace.dropdown.delete' }),
      },
    ],
    [intl]
  );
  const getDropdownItemsByRecord = useCallback(
    (record: any) => {
      if (record?.type === 'chat') {
        return dropdownItems?.filter(
          (item) => item && !['download', 'save'].includes((item.key as string) || '')
        ) as MenuProps['items'];
      }
      return dropdownItems;
    },
    [dropdownItems]
  );
  const handleDownloadRecord = useCallback(
    async (record: any) => {
      const resourceId = record?.resourceId ?? record?.datasetId ?? record?.datasetResourceId;
      const name = record?.fileName || record?.name || record?.title;
      const directoryPath =
        record?.directoryPath ?? (name ? (String(name).startsWith('/') ? String(name) : `/${String(name)}`) : '');
      if (resourceId === null || resourceId === undefined || `${resourceId}` === '' || !directoryPath) {
        message.warning(intl.formatMessage({ id: 'achievementSpace.download.noFile' }));
        return;
      }
      const hide = message.loading(intl.formatMessage({ id: 'common.downloadLoading' }), 0);
      try {
        const res = await downloadResourceFile({ resourceId, directoryPath });
        downloadFile(res);
      } catch (error) {
        console.error('下载文件失败', error);
        message.error(intl.formatMessage({ id: 'common.downloadFailed' }));
      } finally {
        hide?.();
      }
    },
    [intl]
  );
  const handleClosePreview = useCallback(() => {
    setPreviewVisible(false);
    setPreviewContent(undefined);
    setPreviewMeta({});
  }, []);
  const handlePreview = useCallback(
    async (record: any) => {
      const previewName = record.name || record.fileName || intl.formatMessage({ id: 'common.previewDefaultName' });
      let previewUrl = record.url || record.fileUrl || record.previewUrl;
      if (!previewUrl) {
        message.warning(intl.formatMessage({ id: 'common.previewNoUrl' }));
        return;
      }
      if (previewUrl.startsWith('/WaManagerService')) {
        previewUrl = `/byaiService${previewUrl}`;
      }

      setPreviewMeta({
        name: previewName,
        type: typeKey(record),
      });
      setPreviewContent(undefined);
      setPreviewVisible(true);
      setPreviewLoading(true);

      try {
        const response = await fetch(previewUrl);
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const blob = await response.blob();
        setPreviewContent(blob);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('预览文件失败', error);
        message.error(intl.formatMessage({ id: 'common.previewFailed' }));
        setPreviewVisible(false);
        setPreviewContent(undefined);
        setPreviewMeta({});
      } finally {
        setPreviewLoading(false);
      }
    },
    [intl, typeKey]
  );
  useEffect(() => {
    const loadImageUrls = async () => {
      const imageRecords = tableData.filter((record) => record.type === 'image');

      setImageUrlMap((prev) => {
        const urlsToLoad: Array<{ id: string; record: any }> = [];

        imageRecords.forEach((record) => {
          if (!prev[record.id]) {
            urlsToLoad.push({ id: record.id, record });
          }
        });

        if (urlsToLoad.length > 0) {
          const loadPromises = urlsToLoad.map(async ({ id, record }) => {
            try {
              let previewUrl = record.url;
              if (!previewUrl) return;

              if (previewUrl.startsWith('/WaManagerService')) {
                previewUrl = `/byaiService${previewUrl}`;
              }

              // 如果已经是完整URL，直接使用
              if (
                previewUrl.startsWith('http://') ||
                previewUrl.startsWith('https://') ||
                previewUrl.startsWith('data:')
              ) {
                setImageUrlMap((current) => ({ ...current, [id]: previewUrl }));
                return;
              }

              const response = await fetch(previewUrl);
              if (!response.ok) {
                throw new Error(response.statusText);
              }
              const blob = await response.blob();
              if (blob) {
                const uri = URL.createObjectURL(blob);
                setImageUrlMap((current) => ({ ...current, [id]: uri }));
              }
            } catch (error) {
              // 加载失败时使用原始 URL 作为兜底
              const fallbackUrl = record.url || record.fileUrl || record.previewUrl || record.content;
              if (fallbackUrl) {
                setImageUrlMap((current) => ({ ...current, [id]: fallbackUrl }));
              }
            }
          });

          Promise.all(loadPromises).catch(() => {
            // 忽略加载错误
          });
        }

        return prev;
      });
    };

    if (tableData.length > 0) {
      loadImageUrls();
    }

    return () => {
      // 清理 blob URL
      setImageUrlMap((prev) => {
        Object.values(prev).forEach((url) => {
          if (typeof url === 'string' && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
        });
        return {};
      });
    };
  }, [tableData]);
  const showDeleteConfirm = useCallback(
    (record: any) => {
      Modal.confirm({
        title: intl.formatMessage({ id: 'achievementSpace.delete.confirmTitle' }),
        content: intl.formatMessage(
          { id: 'achievementSpace.delete.confirmContent' },
          {
            name: record.name,
          }
        ),
        okText: intl.formatMessage({ id: 'common.confirm' }),
        cancelText: intl.formatMessage({ id: 'common.cancel' }),
        onOk: async () => {
          try {
            await deleteShowcase({ id: record.id });
            message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
            await loadShowcaseList({ targetPage: pageNum });
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('删除成果失败', error);
            message.error(intl.formatMessage({ id: 'common.deleteFailed' }));
          }
        },
      });
    },
    [intl, loadShowcaseList, pageNum]
  );

  useEffect(() => {
    loadShowcaseList({ targetPage: 1, targetSize: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, keyword]);

  const formatTime = useCallback((record: any) => {
    const target = record.updateTime || record.modifiedTime || record.createTime;
    if (!target) {
      return '--';
    }
    const asNumber = Number(target);
    const date = Number.isNaN(asNumber) ? dayjs(target) : dayjs(asNumber);
    return date.isValid() ? date.format('YYYY/MM/DD HH:mm') : String(target);
  }, []);

  const locateMessage = useLocateMessage();
  const handleOpenSaveModal = useCallback((record: any) => {
    setPendingSaveRecord(record);
    setSaveKnowledgeVisible(true);
  }, []);

  const handleCloseSaveModal = useCallback(() => {
    setSaveKnowledgeVisible(false);
    setPendingSaveRecord(undefined);
  }, []);

  const handleOpenRenameModal = useCallback(
    (record: any) => {
      setCollectRecord(record);
      let displayName = record.name || '';
      let fileExtension = '';

      // 如果不是 chat 类型，提取文件后缀
      if (record.type !== 'chat' && record.name) {
        const lastDotIndex = record.name.lastIndexOf('.');
        if (lastDotIndex > 0 && lastDotIndex < record.name.length - 1) {
          fileExtension = record.name.substring(lastDotIndex);
          displayName = record.name.substring(0, lastDotIndex);
        }
      }

      setRenameFileExtension(fileExtension);
      renameForm.setFieldsValue({ name: displayName });
      setRenameVisible(true);
    },
    [renameForm]
  );

  const handleCloseRenameModal = useCallback(() => {
    setRenameVisible(false);
    setCollectRecord(undefined);
    setRenameFileExtension('');
    renameForm.resetFields();
  }, [renameForm]);

  const handleRename = useCallback(async () => {
    try {
      const values = await renameForm.validateFields();
      if (!collectRecord?.id) {
        return;
      }
      // 如果不是 chat 类型，需要在文件名后加上后缀
      let finalName = values.name;
      if (collectRecord.type !== 'chat' && renameFileExtension) {
        finalName = `${values.name}${renameFileExtension}`;
      }
      await renameShowcase({
        id: collectRecord.id,
        name: finalName,
      });
      message.success(intl.formatMessage({ id: 'common.renameSuccess' }));
      handleCloseRenameModal();
      await loadShowcaseList({ targetPage: pageNum });
    } catch (error: any) {
      if (error?.errorFields) {
        // 表单验证错误
        return;
      }
      console.error('重命名失败', error);
      message.error(intl.formatMessage({ id: 'common.renameFailed' }));
    }
  }, [renameForm, collectRecord, renameFileExtension, intl, handleCloseRenameModal, loadShowcaseList, pageNum]);

  const handleCardBodyClick = useCallback(
    (record: any) => {
      if (record.type === 'chat') {
        setChatId(record.id);
      } else {
        handlePreview(record);
      }
    },
    [handlePreview]
  );

  const shouldRenderPreview = previewVisible || previewLoading || !!previewContent;

  return (
    <>
      <div className={styles.container}>
        <div className={styles.sectionCard}>
          <div className={styles.headerBar}>
            <div className={styles.categoryGroup}>
              {categories.map((category: any) => (
                <Button
                  key={category.paramValue}
                  className={classNames(styles.categoryButton, {
                    [styles.categoryButtonActive]: category.paramValue === activeCategory,
                  })}
                  onClick={() => setActiveCategory(category.paramValue)}
                >
                  {category.paramName}
                </Button>
              ))}
            </div>
            <Input.Search
              allowClear
              className={styles.searchInput}
              placeholder={intl.formatMessage({ id: 'achievementSpace.searchPlaceholder' })}
              value={searchInput}
              onChange={(event) => {
                const { value } = event.target;
                setSearchInput(value);
                if (!value) {
                  setKeyword('');
                }
              }}
              onSearch={handleSearch}
            />
          </div>

          <div className={styles.tableHeader}>
            <Typography.Title level={5} className={styles.tableTitle}>
              {intl.formatMessage({ id: 'achievementSpace.section.allFiles' })}
            </Typography.Title>
          </div>

          <Spin spinning={tableLoading}>
            <div className={styles.cardGrid}>
              {tableData.map((record) => {
                const currentTypeKey = typeKey(record);
                const iconType = typeIconMap[currentTypeKey] ?? typeIconMap.other;
                return (
                  <div key={record.id} className={styles.fileCard}>
                    <div className={classNames(styles.fileCardHeader, 'ub ub-ac gap8')}>
                      <span
                        className={classNames(styles.fileIconWrapper, {
                          [styles.folderIconWrapper]: currentTypeKey === 'folder',
                        })}
                      >
                        {record.type === 'chat' ? (
                          <div className={styles.chatImg} style={{ width: 16, height: 16 }} />
                        ) : (
                          <AntdIcon
                            style={{ fontSize: 16 }}
                            type={iconType || typeIconMap.other}
                            className={classNames(styles.fileIcon, styles[`fileIcon${currentTypeKey}`])}
                          />
                        )}
                      </span>
                      <div className={classNames(styles.fileNameCell, 'ub-f1')}>
                        <Typography.Text className={styles.mainFileName} ellipsis title={record.name}>
                          {record.name}
                        </Typography.Text>
                      </div>
                    </div>
                    <div className={styles.fileCardBody} onClick={() => handleCardBodyClick(record)}>
                      {record.type === 'image' && imageUrlMap[record.id] ? (
                        <img src={imageUrlMap[record.id]} alt={record.name} className={styles.fileCardImage} />
                      ) : record.type === 'chat' ? (
                        <div className={styles.chatImg} style={{ width: 34, height: 34 }} />
                      ) : (
                        <AntdIcon
                          style={{ fontSize: CARD_BODY_ICON_SIZE }}
                          type={iconType || typeIconMap.other}
                          className={classNames(styles.fileBodyIcon, styles[`fileIcon${currentTypeKey}`])}
                        />
                      )}
                    </div>
                    <div className={styles.fileCardFooter}>
                      <Button
                        loading={locateMsgLoading}
                        className={styles.enterButton}
                        icon={<AntdIcon type="icon-huihua" />}
                        disabled={!record.sessionId}
                        onClick={() => {
                          if (record.sessionId) {
                            if (record.type === 'chat') {
                              const rawContent = record.content;
                              const parsedMessageId =
                                typeof rawContent === 'string'
                                  ? rawContent
                                      .split(',')
                                      .map((item) => item.trim())
                                      .filter(Boolean)?.[0] ?? rawContent
                                  : rawContent;
                              setLocateMsgLoading(true);
                              locateMessage({
                                sessionId: record.sessionId,
                                messageId: parsedMessageId,
                                agentId: record.agentId,
                              }).finally(() => {
                                setLocateMsgLoading(false);
                              });
                            } else {
                              setLocateMsgLoading(true);
                              locateMessage({
                                sessionId: record.sessionId,
                                messageId: record.messageId,
                                agentId: record.agentId,
                              }).finally(() => {
                                setLocateMsgLoading(false);
                              });
                            }
                          }
                        }}
                      >
                        {intl.formatMessage({ id: 'achievementSpace.action.enterDialogue' })}
                      </Button>
                      <Dropdown
                        overlayClassName={styles.dropdownMenu}
                        menu={{
                          items: getDropdownItemsByRecord(record),
                          onClick: ({ key: actionKey, domEvent }) => {
                            domEvent?.stopPropagation();
                            if (actionKey === 'delete') {
                              showDeleteConfirm(record);
                              return;
                            }
                            if (actionKey === 'detail') {
                              if (record.type === 'chat') {
                                setChatId(record.id);
                              } else {
                                handlePreview(record);
                              }
                              return;
                            }
                            if (actionKey === 'save') {
                              handleOpenSaveModal(record);
                              return;
                            }
                            if (actionKey === 'download') {
                              handleDownloadRecord(record);
                              return;
                            }
                            if (actionKey === 'rename') {
                              handleOpenRenameModal(record);
                              return;
                            }
                            if (actionKey === 'share') {
                              setCollectRecord(record);
                              setSessionSelectOpen(true);
                              return;
                            }
                            message.info(
                              intl.formatMessage(
                                { id: 'achievementSpace.feedback.menuAction' },
                                {
                                  action: intl.formatMessage({ id: `achievementSpace.dropdown.${actionKey}` }),
                                  name: record.name,
                                }
                              )
                            );
                          },
                        }}
                        trigger={['click']}
                      >
                        <Button icon={<AntdIcon type="icon-a-Moregengduo" />} shape="circle" type="text" />
                      </Dropdown>
                    </div>
                    <div className={styles.timeTextFooter}>
                      <Typography.Text className={styles.timeText}>{formatTime(record)}</Typography.Text>
                    </div>
                  </div>
                );
              })}
            </div>
          </Spin>

          {!tableData.length && !tableLoading ? (
            <Empty className={styles.emptyState} description={intl.formatMessage({ id: 'common.noData' })} />
          ) : null}

          <div className={styles.paginationWrapper} style={{ display: 'none' }}>
            <Pagination
              current={pageNum}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              onChange={(current, size) => {
                loadShowcaseList({ targetPage: current, targetSize: size });
              }}
            />
          </div>
        </div>
      </div>

      {shouldRenderPreview &&
        createPortal(
          <Animated
            active={previewVisible}
            compute={(opened) => ({ className: opened ? styles.previewFullscreen : styles.previewNone })}
          >
            <div className={styles.previewPanel}>
              {previewLoading && (
                <div className={styles.previewLoading}>
                  <Spin />
                </div>
              )}
              {!previewLoading && previewContent && (
                <React.Suspense fallback={<Spin />}>
                  <PreViewFile
                    data={previewContent}
                    type={previewMeta.type as any}
                    title={previewMeta.name}
                    className={styles.previewTwins}
                    extra={
                      <span className={styles.previewCloseIcon}>
                        <AntdIcon type="icon-a-Closeguanbi1" onClick={handleClosePreview} />
                      </span>
                    }
                  />
                </React.Suspense>
              )}
              {!previewLoading && !previewContent && (
                <div className={styles.previewEmpty}>
                  <Empty description={intl.formatMessage({ id: 'achievementSpace.preview.noContent' })} />
                </div>
              )}
            </div>
          </Animated>,
          document.body
        )}

      <MessagesModal chatId={chatId} setChatId={setChatId} />
      {saveKnowledgeVisible && (
        <KnowledgeBaseModal
          open={saveKnowledgeVisible}
          onClose={handleCloseSaveModal}
          value={[]}
          max={1}
          isAchievementSpace
          achievementId={pendingSaveRecord?.id}
          onOk={() => {
            handleCloseSaveModal();
          }}
          title={intl.formatMessage({ id: 'common.selectKnowledgeBase' })}
          mode="knowledgeBase"
          ownershipType={1}
        />
      )}

      <Modal
        title={intl.formatMessage({ id: 'common.rename' })}
        open={renameVisible}
        onOk={handleRename}
        onCancel={handleCloseRenameModal}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item
            name="name"
            label={intl.formatMessage({ id: 'common.fileName' })}
            rules={[
              { required: true, message: intl.formatMessage({ id: 'common.inputFileName' }) },
              { max: 255, message: intl.formatMessage({ id: 'common.fileNameMaxLength' }) },
            ]}
          >
            <Input placeholder={intl.formatMessage({ id: 'common.inputFileName' })} />
          </Form.Item>
        </Form>
      </Modal>

      <ShareSelect
        sessionSelectOpen={sessionSelectOpen}
        notificationMessage={notificationMessage}
        onClose={() => {
          setSessionSelectOpen(false);
        }}
        getExtraInfo={() => {
          return {
            shareSourceType: 'collect',
            shareData: {
              ...pick(collectRecord, ['content', 'type', 'id']),
              previewName:
                collectRecord.name || collectRecord.fileName || intl.formatMessage({ id: 'common.previewDefaultName' }),
              previewUrl: collectRecord.url || collectRecord.fileUrl || collectRecord.previewUrl,
              fileType: typeKey(collectRecord),
            },
          };
        }}
      />
      {contextHolder}
    </>
  );
};

export default AchievementSpacePage;
