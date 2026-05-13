import CardContent from '@/components/CardContent';
import { ResourceFromType } from '@/constants/message';
import { useIntl } from '@umijs/max';
import { downloadFile } from '@/utils/file';
import { GlobalOutlined } from '@ant-design/icons';
import { get } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import AntdIcon from '../AntdIcon';
import DetailDrawer from './DetailDrawer';
import styles from './index.module.less';
import classNames from 'classnames';

export type IDrawerSourceFromInfo = {
  content: string;
  subType: string;
  title: string;
  type: string;
  id: string;
  url?: string;
  chunkList: any[];
  documentUrl?: string;

  /** dataset 下载用，与 queryDirAndFileByLevel 路径语义一致 */
  resourceId?: string | number;
  directoryPath?: string;
  datasetId?: string | number;
  documentId?: string;
};

type IProps = {
  drawerSourceFromInfo: Array<IDrawerSourceFromInfo>;
};

export const RenderSourceIcon = ({ title, fontSize }: { title: string; fontSize?: number }) => {
  const renderIcon = useCallback((title: string, fontSize: number = 16) => {
    let iconType = '';
    if (/\.(doc|docx)$/.test(title)) {
      iconType = 'Word';
    } else if (title.endsWith('.pdf')) {
      iconType = 'PDF';
    } else if (/\.(xls|xlsx)$/.test(title)) {
      iconType = 'Excel';
    } else if (title.endsWith('.txt')) {
      iconType = 'jishiben';
    } else if (title.endsWith('.ppt')) {
      iconType = 'PPT';
    }
    if (iconType) {
      return <AntdIcon type={`icon-${iconType}`} style={{ fontSize }} />;
    }
    return <GlobalOutlined />;
  }, []);

  return <>{renderIcon(title, fontSize)}</>;
};

export const RenderCardContent = ({
  cardItem,
  onClick,
  style,
  className,
}: {
  cardItem: IDrawerSourceFromInfo;
  onClick?: () => Promise<any>;
  style?: React.CSSProperties;
  className?: string;
}) => {
  const intl = useIntl();

  const { content, subType, title, type, id, url, chunkList, documentUrl } = cardItem;

  const canClick = url || chunkList || documentUrl;

  return (
    <CardContent
      title={title}
      content={content}
      source={subType}
      category={intl.formatMessage({ id: get(ResourceFromType, type, '') })}
      className={classNames(styles.cardContent, className, {
        pointer: canClick,
      })}
      onClick={onClick}
      style={style}
      icon={<RenderSourceIcon title={title} fontSize={16} />}
      key={id}
    />
  );
};

export default function ReferenceSource(props: IProps) {
  const { drawerSourceFromInfo = [] } = props;

  const [showDetail, setShowDetail] = React.useState(false);
  const [detailInfo, setDetailInfo] = useState<IDrawerSourceFromInfo | null>(null);

  useEffect(() => {
    return () => {
      setShowDetail(false);
    };
  }, []);

  const hanldeClick = useCallback((item: IDrawerSourceFromInfo) => {
    if (item.url) {
      window.open(item.url, '_blank');
    }
    if (item.chunkList) {
      setShowDetail(true);
      setDetailInfo(item);
    }
    if (item.documentUrl) {
      downloadFile({
        fileUrl: item.documentUrl,
        fileName: item.title,
      });
    }

    return Promise.resolve();
  }, []);

  return (
    <div className="full-width full-height overflow-auto" style={{ padding: '0 12px' }}>
      {drawerSourceFromInfo.map((item) => {
        return (
          <RenderCardContent
            key={item.id}
            cardItem={item}
            onClick={() => {
              return hanldeClick(item);
            }}
          />
        );
      })}
      <DetailDrawer drawerOpen={showDetail} detailInfo={detailInfo} setShowDetail={setShowDetail} />
    </div>
  );
}
