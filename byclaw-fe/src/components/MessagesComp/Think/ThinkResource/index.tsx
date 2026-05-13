// tslint:disable:ordered-imports
import React, { useMemo, useState, useCallback } from 'react';
import { get, isString } from 'lodash';
import classnames from 'classnames';
import { downloadFile } from '@/utils/file';
import DetailDrawer from '@/components/ReferenceSource/DetailDrawer';
import { RenderCardContent, IDrawerSourceFromInfo } from '@/components/ReferenceSource';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

import styles from './index.module.less';

const ITEM_WIDTH = 240;
const ITEM_MARGIN = 6;

type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  messageListItemContent: { substance: string };
};

export default function CarouselCard(props: IProps) {
  const listStr = get(props, 'messageListItemContent.substance', '');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetail, setShowDetail] = React.useState(false);
  const [detailInfo, setDetailInfo] = useState<IDrawerSourceFromInfo | null>(null);

  const list = useMemo<IDrawerSourceFromInfo[]>(() => {
    try {
      if (isString(listStr)) {
        return JSON.parse(listStr);
      }
      if (Array.isArray(listStr)) {
        return listStr;
      }

      return [];
    } catch (e) {
      console.error(e);
    }
    return [];
  }, [listStr]);

  const handleChange = (index: number) => {
    setCurrentIndex(() => {
      if (index <= 0) {
        return 0;
      }
      if (index >= list.length - 1) {
        return list.length - 1;
      }
      return index;
    });
  };

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
    <>
      <div className={classnames(styles.carouselCardContainer)}>
        {currentIndex > 0 && (
          <div className={classnames(styles.carouselCardIconLeft, 'ub ub-ac')}>
            <LeftOutlined onClick={() => handleChange(currentIndex - 1)} />
          </div>
        )}
        {currentIndex < list.length - 3 && (
          <div className={classnames(styles.carouselCardIconRight, 'ub ub-ac')}>
            <RightOutlined onClick={() => handleChange(currentIndex + 1)} />
          </div>
        )}
        <div
          className={classnames(styles.carouselCardBlock, 'ub ub-ac')}
          style={{
            transform: `translateX(-${currentIndex * (ITEM_WIDTH + ITEM_MARGIN)}px)`,
          }}
        >
          {list.map((item) => {
            return (
              <RenderCardContent
                cardItem={item}
                key={item.id || item.title}
                className={styles.cardContent}
                style={{
                  minWidth: `${ITEM_WIDTH}px`,
                  maxWidth: `${ITEM_WIDTH}px`,
                  marginRight: `${ITEM_MARGIN}px`,
                }}
                onClick={() => {
                  return hanldeClick(item);
                }}
              />
            );
          })}
        </div>
      </div>
      <DetailDrawer drawerOpen={showDetail} detailInfo={detailInfo} setShowDetail={setShowDetail} />
    </>
  );
}
