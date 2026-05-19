import React, { useState, useEffect, useImperativeHandle, useMemo } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import { List, Spin, message, Empty, Button, Input, Tooltip } from 'antd';
import { SearchOutlined, CloseOutlined } from '@ant-design/icons';
import AntdIcon from '@/components/AntdIcon';
import { debounce } from 'lodash';
import { qryByClawFileByUserCode } from '@/service/workSpace';
import { readFile } from '@/pages/manager/service/resources';
import styles from './Achievements.module.less';
import { EventEmitter$Cls } from '@/utils/eventEmitter';

const getResourceIcon = (fileName: string) => {
  const normalizedName = `${fileName || ''}`.toLowerCase();

  if (normalizedName.endsWith('.csv')) {
    return 'icon-CSV';
  }
  if (normalizedName.endsWith('.pdf')) {
    return 'icon-PDF';
  }
  if (/\.(doc|docx|docs)$/.test(normalizedName)) {
    return 'icon-Word';
  }
  if (/\.(png|jpg|jpeg|gif|webp|bmp|tif|tiff|svg|ico|heic)$/.test(normalizedName)) {
    return 'icon-Image';
  }
  if (normalizedName.endsWith('.txt')) {
    return 'icon-jishiben';
  }
  if (normalizedName.endsWith('.json')) {
    return 'icon-json';
  }
  if (normalizedName.endsWith('.java')) {
    return 'icon-Java';
  }
  if (normalizedName.endsWith('.sql')) {
    return 'icon-sql1';
  }
  if (normalizedName.endsWith('.html')) {
    return 'icon-html';
  }
  if (/\.(xls|xlsx)$/.test(normalizedName)) {
    return 'icon-Excel';
  }
  if (/\.(ppt|pptx|pptm)$/.test(normalizedName)) {
    return 'icon-PPT';
  }
  if (/\.(md|markdown)$/.test(normalizedName)) {
    return 'icon-markdown';
  }
  if (normalizedName.endsWith('.py')) {
    return 'icon-python';
  }
  if (normalizedName.endsWith('.js')) {
    return 'icon-javascript';
  }
  if (normalizedName.endsWith('.ts')) {
    return 'icon-typescript';
  }
  if (normalizedName.endsWith('.css')) {
    return 'icon-css';
  }
  if (normalizedName.endsWith('.xml')) {
    return 'icon-xml';
  }
  if (normalizedName.endsWith('.yaml') || normalizedName.endsWith('.yml')) {
    return 'icon-yaml';
  }
  if (normalizedName.endsWith('.sh')) {
    return 'icon-shell';
  }
  if (normalizedName.endsWith('.go')) {
    return 'icon-golang';
  }
  if (normalizedName.endsWith('.rs')) {
    return 'icon-rust';
  }
  if (normalizedName.endsWith('.cpp') || normalizedName.endsWith('.cc') || normalizedName.endsWith('.cxx')) {
    return 'icon-cpp';
  }
  if (normalizedName.endsWith('.c')) {
    return 'icon-c';
  }
  if (normalizedName.endsWith('.php')) {
    return 'icon-php';
  }
  if (normalizedName.endsWith('.rb')) {
    return 'icon-ruby';
  }
  if (normalizedName.endsWith('.swift')) {
    return 'icon-swift';
  }
  if (normalizedName.endsWith('.kt')) {
    return 'icon-kotlin';
  }
  if (normalizedName.endsWith('.dart')) {
    return 'icon-dart';
  }
  if (normalizedName.endsWith('.vue')) {
    return 'icon-vue';
  }
  if (normalizedName.endsWith('.react') || normalizedName.endsWith('.jsx') || normalizedName.endsWith('.tsx')) {
    return 'icon-react';
  }
  if (normalizedName.endsWith('.gitignore')) {
    return 'icon-git';
  }
  if (normalizedName.endsWith('.dockerignore') || normalizedName.includes('docker')) {
    return 'icon-docker';
  }
  if (normalizedName.endsWith('.env')) {
    return 'icon-environment';
  }
  if (normalizedName.endsWith('.lock')) {
    return 'icon-lock';
  }

  return 'icon-file';
};

interface SpaceFileItem {
  objectKey: string;
  fileName: string;
}

interface AchievementsProps {
  onClose?: () => void;
  sessionId: string | number;
}

interface AchievementsTriggerProps extends AchievementsProps {
  defaultOpen?: boolean;
  EventEmitter: EventEmitter$Cls;
}

export interface TriggerRef {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

interface iAchievements {
  (props: AchievementsProps): React.JSX.Element;
  Trigger: React.ForwardRefExoticComponent<AchievementsTriggerProps & React.RefAttributes<TriggerRef>>;
}

const Achievements: iAchievements = (props) => {
  const { sessionId, onClose } = props;
  const intl = useIntl();
  const { userInfo } = useSelector((state: any) => state.user);

  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<SpaceFileItem[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [downloadingKeys, setDownloadingKeys] = useState<Set<string>>(new Set());

  const loadFiles = async (keyword?: string) => {
    if (!sessionId) return;

    setLoading(true);
    try {
      // 参考 ResourceCitation 的调用方式
      const response = await qryByClawFileByUserCode({
        userCode: userInfo?.userCode,
        keyword: keyword || '',
        sessionId: sessionId.toString(),
      });

      const dataList = Array.isArray(response) ? response : [];
      setFileList(dataList);
    } catch (error) {
      console.error('Failed to load space files:', error);
      message.error(intl.formatMessage({ id: 'workSpace.fileView.loadFail' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [sessionId]);

  const onSearch = debounce((keyword: string) => {
    loadFiles(keyword);
  }, 200);

  const handleDownload = async (item: SpaceFileItem) => {
    const { objectKey } = item;

    if (downloadingKeys.has(objectKey)) {
      return;
    }

    setDownloadingKeys((prev) => new Set(prev).add(objectKey));

    try {
      const userCode = userInfo?.userCode || '3174953401447148';
      const parts = item.objectKey?.split('/') || [];
      const fileSessionId = parts.length >= 2 ? parts[2] : sessionId.toString();
      const filePath = item.fileName || '';

      const response = await readFile({
        userCode,
        sessionId: fileSessionId,
        filePath,
        begin_line: 0,
        end_line: -1,
        objectKey: item.objectKey || '',
      });

      if (response?.file) {
        const blob = new Blob([response.file], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.fileName || 'file.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        message.error(intl.formatMessage({ id: 'resource.downloadFailedNoContent' }));
      }
    } catch (error) {
      console.error('下载失败：', error);
      message.error(intl.formatMessage({ id: 'resource.downloadFailedRetry' }));
    } finally {
      setDownloadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(objectKey);
        return next;
      });
    }
  };

  const debouncedHandleDownload = useMemo(() => debounce(handleDownload, 500, { leading: true, trailing: false }), []);

  const filteredFiles = fileList.filter((item) => {
    if (!searchValue.trim()) return true;
    return item.fileName.toLowerCase().includes(searchValue.toLowerCase());
  });

  return (
    <section className={styles.achievements}>
      <header className={styles.header}>
        <h3 className={styles.title}>{intl.formatMessage({ id: 'workSpace.achievements.title' })}</h3>
        <div className={styles.closeButton}>
          <CloseOutlined size={16} onClick={onClose} />
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.searchBar}>
          <Input
            placeholder={intl.formatMessage({ id: 'common.searchKeyword' })}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onPressEnter={() => onSearch(searchValue)}
            className={styles.searchInput}
            suffix={<SearchOutlined />}
          />
        </div>
        <div className={styles.fileList}>
          {loading ? (
            <div className={styles.loading}>
              <Spin />
            </div>
          ) : filteredFiles.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              dataSource={filteredFiles}
              renderItem={(item) => (
                <List.Item className={styles.listItem} key={item.objectKey}>
                  <div className={styles.itemContent}>
                    <div className={styles.defaultLogo}>
                      <AntdIcon type={getResourceIcon(item.fileName)} className={styles.defaultLogoIcon} />
                    </div>
                    <Tooltip title={item.fileName}>
                      <span className={styles.fileName}>{item.fileName}</span>
                    </Tooltip>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      key={`download-${item.objectKey}`}
                      size="small"
                      onClick={() => debouncedHandleDownload(item)}
                      disabled={downloadingKeys.has(item.objectKey)}
                    >
                      {intl.formatMessage({ id: 'common.download' })}
                    </Button>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </div>
    </section>
  );
};

Achievements.Trigger = React.forwardRef<TriggerRef, AchievementsTriggerProps>((props, ref) => {
  const { sessionId, EventEmitter, defaultOpen = false } = props;
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);

  useImperativeHandle(ref, () => ({
    open: () => {
      setIsOpen(true);
    },
    close: () => {
      setIsOpen(false);
    },
    toggle: () => {
      setIsOpen((prev) => !prev);
    },
  }));

  useEffect(() => {
    if (isOpen) {
      EventEmitter.emit('beyond-main-driver-open-type', {
        width: '25vw',
        canClose: false,
        minWidth: 260,
        drawerType: <Achievements sessionId={sessionId} onClose={() => setIsOpen(false)} />,
      });
    } else {
      EventEmitter.emit('beyond-main-driver-open-type', '');
    }
  }, [isOpen]);

  return <div key="1" />;
});

export default Achievements;
