import React, { useMemo } from 'react';
import { Button, Empty, Input, List, Modal, Spin, Tooltip, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import styles from './index.module.less';

export interface KnowledgeTargetItem {
  id?: string | number;
  resourceId?: string | number;
  resourceName?: string;
  name?: string;
  resourceDesc?: string;
  description?: string;
}

export interface KnowledgeTargetSelectorProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  okDisabled?: boolean;
  width?: number | string;
  zIndex?: number;
  destroyOnClose?: boolean;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  onSearch: (keyword: string) => void;
  knowledgeBases: KnowledgeTargetItem[];
  knowledgeLoading?: boolean;
  selectedKnowledgeBase?: KnowledgeTargetItem | null;
  onSelectKnowledgeBase: (knowledgeBase: KnowledgeTargetItem) => void;
  onBackToList: () => void;
  directoryPath: string;
  folders: QueryDirAndFileByLevelItem[];
  folderLoading?: boolean;
  onBreadcrumbClick: (directoryPath: string) => void;
  onFolderClick: (folder: QueryDirAndFileByLevelItem, directoryPath: string) => void;
  emptyText?: React.ReactNode;
  folderEmptyText?: React.ReactNode;
  className?: string;
}

type KnowledgeTargetSelectorContentProps = Omit<
  KnowledgeTargetSelectorProps,
  'open' | 'onOk' | 'onCancel' | 'confirmLoading' | 'okDisabled' | 'width' | 'zIndex' | 'destroyOnClose'
>;

function normalizeDirectoryPath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function joinDirectoryPath(parentPath: string, name: string) {
  return normalizeDirectoryPath(`${normalizeDirectoryPath(parentPath)}/${name}`);
}

function buildFolderPath(directoryPath: string, rootTitle: string) {
  const paths = [{ title: rootTitle, id: '/' }];
  let accumulated = '';
  normalizeDirectoryPath(directoryPath)
    .split('/')
    .filter(Boolean)
    .forEach((segment) => {
      accumulated += `/${segment}`;
      paths.push({ title: segment, id: accumulated });
    });
  return paths;
}

function getKnowledgeBaseId(item: KnowledgeTargetItem) {
  return item.resourceId ?? item.id;
}

function getKnowledgeBaseName(item: KnowledgeTargetItem) {
  return item.resourceName ?? item.name ?? getKnowledgeBaseId(item) ?? '';
}

const KnowledgeTargetSelectorContent: React.FC<KnowledgeTargetSelectorContentProps> = (props) => {
  const {
    keyword,
    onKeywordChange,
    onSearch,
    knowledgeBases,
    knowledgeLoading = false,
    selectedKnowledgeBase,
    onSelectKnowledgeBase,
    onBackToList,
    directoryPath,
    folders,
    folderLoading = false,
    onBreadcrumbClick,
    onFolderClick,
    emptyText,
    folderEmptyText,
    className,
  } = props;
  const intl = useIntl();

  const folderPath = useMemo(
    () => buildFolderPath(directoryPath, intl.formatMessage({ id: 'fileBrowser.root' })),
    [directoryPath, intl]
  );

  if (selectedKnowledgeBase) {
    const selectedName = getKnowledgeBaseName(selectedKnowledgeBase);
    return (
      <div className={[styles.selector, className].filter(Boolean).join(' ')}>
        <div className={styles.folderHeader}>
          <Button
            size="small"
            className={styles.backButton}
            onClick={onBackToList}
            icon={<AntdIcon type="icon-a-Leftzuo" />}
          >
            {intl.formatMessage({ id: 'fileSider.saveToKnowledge.backToList' })}
          </Button>
          <span className={styles.selectedTitle}>{selectedName}</span>
        </div>
        <KnowledgeBreadcrumb
          folderPath={folderPath}
          handleBreadcrumbClick={(index) => {
            const target = folderPath[index];
            if (target) {
              onBreadcrumbClick(target.id);
            }
          }}
        />
        <Spin spinning={folderLoading}>
          <List
            className={styles.folderList}
            dataSource={folders}
            locale={{
              emptyText: folderEmptyText ?? intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' }),
            }}
            renderItem={(folder) => {
              const nextPath =
                String(folder.directoryPath ?? '').trim() || joinDirectoryPath(directoryPath, folder.name);
              const normalizedNextPath = normalizeDirectoryPath(nextPath);
              return (
                <List.Item className={styles.folderItem} onClick={() => onFolderClick(folder, normalizedNextPath)}>
                  <List.Item.Meta
                    className={styles.folderMeta}
                    avatar={<AntdIcon type="icon-wenjianjialanse" className={styles.folderIcon} />}
                    title={
                      <Tooltip title={folder.name}>
                        <Typography.Text ellipsis>{folder.name}</Typography.Text>
                      </Tooltip>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Spin>
      </div>
    );
  }

  return (
    <div className={[styles.selector, className].filter(Boolean).join(' ')}>
      <div className={styles.toolbar}>
        <Input.Search
          allowClear
          value={keyword}
          placeholder={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.searchPlaceholder' })}
          onChange={(event) => onKeywordChange(event.target.value)}
          onSearch={onSearch}
          className={styles.search}
        />
      </div>
      <Spin spinning={knowledgeLoading}>
        <div className={styles.content}>
          {knowledgeBases.length ? (
            <div className={styles.cardGrid}>
              {knowledgeBases.map((item) => {
                const id = getKnowledgeBaseId(item);
                const idStr = String(id);
                const name = String(getKnowledgeBaseName(item));
                const desc = item.resourceDesc ?? item.description;
                return (
                  <div
                    key={idStr}
                    className={styles.card}
                    onClick={() => {
                      onSelectKnowledgeBase(item);
                    }}
                  >
                    <span className={styles.cardIcon}>
                      <AntdIcon type="icon-chuangjianfangshi-wendangku" />
                    </span>
                    <div className={styles.cardBody}>
                      <Tooltip title={name}>
                        <Typography.Text ellipsis className={styles.cardTitle}>
                          {name}
                        </Typography.Text>
                      </Tooltip>
                      {desc && (
                        <Tooltip title={String(desc)}>
                          <Typography.Text ellipsis className={styles.cardDesc}>
                            {desc}
                          </Typography.Text>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            !knowledgeLoading && (
              <Empty description={emptyText ?? intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })} />
            )
          )}
        </div>
      </Spin>
    </div>
  );
};

const KnowledgeTargetSelector: React.FC<KnowledgeTargetSelectorProps> = (props) => {
  const {
    open,
    onOk,
    onCancel,
    confirmLoading,
    okDisabled,
    width,
    zIndex,
    destroyOnClose = true,
    ...selectorProps
  } = props;
  const intl = useIntl();

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'fileSider.saveToKnowledge' })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: okDisabled }}
      onOk={onOk}
      onCancel={onCancel}
      width={width}
      zIndex={zIndex}
      destroyOnClose={destroyOnClose}
    >
      <KnowledgeTargetSelectorContent {...selectorProps} />
    </Modal>
  );
};

export default KnowledgeTargetSelector;
