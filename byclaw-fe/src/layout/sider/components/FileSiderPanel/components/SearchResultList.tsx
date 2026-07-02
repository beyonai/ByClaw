import React, { type Key } from 'react';
import { Dropdown, Empty, List, Spin, Tooltip, type MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import type { FileBrowserItem } from '@/service/fileBrowser';
import { canPreviewFile, getIconType, isDirectory } from '../utils';
import styles from '../index.module.less';

interface SearchResultListProps {
  items: FileBrowserItem[];
  loading: boolean;
  searchValue: string;
  onExitSearch: () => void;
  onItemDoubleClick: (item: FileBrowserItem) => void;
  onPreview: (item: FileBrowserItem) => void;
  getActionItems: (item: FileBrowserItem) => MenuProps['items'];
  onAction: (key: Key, item: FileBrowserItem) => void;
}

const SearchResultList: React.FC<SearchResultListProps> = ({
  items,
  loading,
  searchValue,
  onExitSearch,
  onItemDoubleClick,
  onPreview,
  getActionItems,
  onAction,
}) => {
  const intl = useIntl();

  return (
    <div className={styles.categoryBody}>
      <Spin spinning={loading} wrapperClassName={styles.listSpin}>
        <div className={styles.searchResultBar}>
          <Tooltip title={intl.formatMessage({ id: 'fileBrowser.search.back' })}>
            <button type="button" className={styles.searchBackButton} onClick={onExitSearch}>
              <AntdIcon type="icon-a-Returnfanhui" />
            </button>
          </Tooltip>
          <span className={styles.searchResultText}>
            {items.length > 0
              ? intl.formatMessage({ id: 'fileBrowser.search.result' }, { keyword: searchValue, count: items.length })
              : intl.formatMessage({ id: 'fileBrowser.search.noResult' })}
          </span>
        </div>
        <div className={styles.searchListScroll}>
          {items.length ? (
            <List
              dataSource={items}
              renderItem={(item) => {
                const previewable = canPreviewFile(item);
                const iconType = getIconType(item.name, isDirectory(item));
                return (
                  <List.Item className={styles.searchFileItem} onDoubleClick={() => onItemDoubleClick(item)}>
                    <List.Item.Meta
                      avatar={
                        <span className={styles.searchFileIcon}>
                          <AntdIcon type={`icon-${iconType}`} />
                        </span>
                      }
                      title={
                        <span
                          className={styles.searchFileName}
                          onClick={() => {
                            if (isDirectory(item)) {
                              onItemDoubleClick(item);
                            } else if (previewable) {
                              onPreview(item);
                            }
                          }}
                        >
                          {item.name}
                        </span>
                      }
                      description={
                        <span className={styles.searchPathText} title={item.path}>
                          {item.path}
                        </span>
                      }
                    />
                    <span className={styles.searchMoreActionWrap}>
                      <Dropdown
                        trigger={['hover']}
                        overlayClassName={employeeStyles.mydropdown}
                        menu={{
                          items: getActionItems(item),
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            onAction(key, item);
                          },
                        }}
                      >
                        <span
                          className={styles.searchMoreAction}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <EllipsisOutlined />
                        </span>
                      </Dropdown>
                    </span>
                  </List.Item>
                );
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'fileBrowser.search.noResult' })}
            />
          )}
        </div>
      </Spin>
    </div>
  );
};

export default SearchResultList;
