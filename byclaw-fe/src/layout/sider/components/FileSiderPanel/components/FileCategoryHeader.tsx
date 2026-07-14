import React from 'react';
import { Button, message, Tooltip, Upload } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import type { FileCategoryItem, FileCategoryKey } from '../constants';
import { DISPLAY_FILE_PATH_PREFIX } from '../constants';
import { buildScopedFolderPath, getCategoryActivePath, getCategoryRootPath, getDisplayFileBrowserPath } from '../utils';
import styles from '../index.module.less';

interface FileCategoryHeaderProps {
  category: FileCategoryItem;
  activeCategoryKey: FileCategoryKey | undefined;
  activeSessionId: string;
  currentPath: string;
  title: React.ReactNode;
  onUploadSelect: (category: FileCategoryItem, fileList: File[]) => void;
  onCreateFolder: (path: string) => void;
  onRefresh: (category: FileCategoryItem) => void;
  onOpenPath: (category: FileCategoryItem, path: string) => void;
  onCopyPath: (path: string, event: React.MouseEvent<HTMLElement>) => void;
}

const FileCategoryHeader: React.FC<FileCategoryHeaderProps> = ({
  category,
  activeCategoryKey,
  activeSessionId,
  currentPath,
  title,
  onUploadSelect,
  onCreateFolder,
  onRefresh,
  onOpenPath,
  onCopyPath,
}) => {
  const intl = useIntl();
  const canManageCategory = category.key !== 'log';
  const categoryPath =
    category.key === activeCategoryKey
      ? currentPath || getCategoryActivePath(category, activeSessionId)
      : getCategoryActivePath(category, activeSessionId);
  const categoryRootPath = getCategoryRootPath(category.key);
  const displayCategoryPath = getDisplayFileBrowserPath(categoryPath);
  const pathSegments = buildScopedFolderPath(categoryPath, categoryRootPath);
  const uploadTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.upload' });
  const createTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' });
  const refreshTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.refresh' });
  const handleUnavailableUpload = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    message.info(intl.formatMessage({ id: 'fileBrowser.upload.underConstruction' }));
  };
  const uploadButton = (
    <Button
      icon={<AntdIcon type="icon-a-Uploadshangchuan" className={styles.categoryActionIcon} />}
      size="small"
      className={styles.categoryActionButton}
      onClick={category.uploadUnderConstruction ? handleUnavailableUpload : undefined}
    />
  );

  const pathContent = pathSegments.length ? (
    <>
      {DISPLAY_FILE_PATH_PREFIX}/
      {pathSegments.map((segment) => (
        <React.Fragment key={segment.id}>
          <button
            type="button"
            className={styles.categoryPathSegment}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPath(category, segment.id);
            }}
          >
            {segment.title}
          </button>
          /
        </React.Fragment>
      ))}
    </>
  ) : (
    <button
      type="button"
      className={styles.categoryPathSegment}
      onClick={(event) => {
        event.stopPropagation();
        onOpenPath(category, categoryPath);
      }}
    >
      {displayCategoryPath}
    </button>
  );

  return (
    <div
      className={[styles.categoryHeader, category.key === activeCategoryKey ? styles.categoryHeaderActive : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className={[styles.categoryHeaderMain, styles.categoryHeaderMainWithActions].filter(Boolean).join(' ')}>
        <span className={styles.categoryTitle}>{title}</span>
        <span className={styles.categoryActions} onClick={(event) => event.stopPropagation()}>
          {canManageCategory && (
            <Tooltip title={uploadTitle}>
              {category.uploadUnderConstruction ? (
                uploadButton
              ) : (
                <Upload
                  showUploadList={false}
                  multiple
                  beforeUpload={(_, fileList) => {
                    onUploadSelect(category, fileList as unknown as File[]);
                    return false;
                  }}
                >
                  {uploadButton}
                </Upload>
              )}
            </Tooltip>
          )}
          {canManageCategory && (
            <Tooltip title={createTitle}>
              <Button
                icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" className={styles.categoryActionIcon} />}
                size="small"
                className={styles.categoryActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateFolder(categoryPath);
                }}
              />
            </Tooltip>
          )}
          <Tooltip title={refreshTitle}>
            <Button
              icon={<AntdIcon type="icon-a-Refreshshuaxin1" className={styles.categoryActionIcon} />}
              size="small"
              className={styles.categoryActionButton}
              onClick={(event) => {
                event.stopPropagation();
                onRefresh(category);
              }}
            />
          </Tooltip>
        </span>
      </div>
      <span className={styles.categoryPathRow} title={displayCategoryPath}>
        <span className={styles.categoryPath} onClick={(event) => event.stopPropagation()}>
          {pathContent}
        </span>
        <Tooltip title={intl.formatMessage({ id: 'common.copy' })}>
          <button
            type="button"
            className={styles.categoryPathCopy}
            onClick={(event) => onCopyPath(categoryPath, event)}
          >
            <CopyOutlined />
          </button>
        </Tooltip>
      </span>
    </div>
  );
};

export default FileCategoryHeader;
