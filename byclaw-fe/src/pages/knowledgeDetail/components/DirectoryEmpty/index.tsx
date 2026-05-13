import AntdIcon from '@/components/AntdIcon';
import Empty from '@/components/Empty';
import { Button } from 'antd';
import styles from './index.module.less';
// @ts-ignore
import { useIntl } from '@umijs/max';
import UploadFile from '../UploadFile';

interface DirectoryEmptyProps {
  baseInfo: any;
  setShowAddFolder: (show: boolean) => void;
  uploadLoading: boolean;
  setUploadLoading: (loading: boolean) => void;
  reload?: () => void;
  directoryPath: string;
}

const DirectoryEmpty = ({
  baseInfo,
  setShowAddFolder,
  uploadLoading,
  setUploadLoading,
  reload,
  directoryPath,
}: DirectoryEmptyProps) => {
  const intl = useIntl();

  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <Empty description="" />
      <p className={styles.emptyTitle}>{intl.formatMessage({ id: 'directoryEmpty.noContent' })}</p>
      <p className={styles.emptyDesc}>{intl.formatMessage({ id: 'directoryEmpty.emptyDesc' })}</p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          justifyContent: 'center',
        }}
      >
        <Button
          icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" style={{ fontSize: 18 }} />}
          onClick={() => setShowAddFolder(true)}
        >
          {intl.formatMessage({ id: 'knowledgeDetail.newFolder' })}
        </Button>
        <UploadFile
          baseInfo={baseInfo}
          uploadLoading={uploadLoading}
          setUploadLoading={setUploadLoading}
          reload={reload}
          directoryPath={directoryPath}
        />
      </div>
    </div>
  );
};

export default DirectoryEmpty;
