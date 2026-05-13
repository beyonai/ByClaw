import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import React, { useCallback, useState } from 'react';
import { debounce } from 'lodash';

import CiteRender from '@/components/MessageList/components/CiteRender';
import FileRender from '@/components/MessageList/components/FileRender';

import type { ICiteRender } from '@/components/MessageList/components/CiteRender';
import type { IFileRender } from '@/components/MessageList/components/FileRender';

import styles from './index.module.less';
import { IMessage } from '@/typescript/message';

export type IItem = ICiteRender | IFileRender;

export interface CarouselCardProps {
  items: Array<IItem>;
  className?: string;
  sessionId?: string;
  onClose?: (fileItem: IItem) => void;
  iconRender?: (fileItem: IItem) => React.ReactNode;
  message?: IMessage;
}

const ITEM_WIDTH = 220;
const ITEM_MARGIN = 12;

const CarouselFile: React.FC<CarouselCardProps> = (props: CarouselCardProps) => {
  const { items, className, ...rest } = props;

  const [currentIndex, setCurrentIndex] = useState(0);

  const handleChange = (index: number) => {
    setCurrentIndex(() => {
      if (index <= 0) {
        return 0;
      }
      if (index >= items.length - 1) {
        return items.length - 1;
      }
      return index;
    });
  };

  // 鼠标滚轮滚动处理
  const handleWheel = useCallback(
    debounce((e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 根据滚轮方向切换内容
      if (e.deltaX > 0 || e.deltaY > 0) {
        // 向下滚动或向右滚动，显示下一组
        if (currentIndex < items.length - 3) {
          handleChange(currentIndex + 1);
        }
      } else if (e.deltaX < 0 || e.deltaY < 0) {
        // 向上滚动或向左滚动，显示上一组
        if (currentIndex > 0) {
          handleChange(currentIndex - 1);
        }
      }
    }, 100),
    [currentIndex, items.length, handleChange]
  );

  return (
    <div className={classNames(styles.carouselCardContainer, className)} onWheel={handleWheel}>
      {currentIndex > 0 && (
        <div className={classNames(styles.carouselCardIconLeft, 'ub ub-ac')}>
          <LeftOutlined onClick={() => handleChange(currentIndex - 1)} />
        </div>
      )}
      {currentIndex < items.length - 3 && (
        <div className={classNames(styles.carouselCardIconRight, 'ub ub-ac')}>
          <RightOutlined onClick={() => handleChange(currentIndex + 1)} />
        </div>
      )}
      <div
        className={classNames(styles.carouselCardBlock, 'ub ub-ac')}
        style={{
          transform: `translateX(-${currentIndex * (ITEM_WIDTH + ITEM_MARGIN)}px)`,
        }}
      >
        {items.map((fileItem, idx) => {
          const { renderFileType = 'file' } = fileItem;

          return (
            <div key={idx} style={{ margin: '0 6px' }}>
              {renderFileType === 'cite' && <CiteRender {...(fileItem as ICiteRender)} {...rest} />}
              {renderFileType === 'file' && <FileRender {...(fileItem as IFileRender)} {...rest} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CarouselFile;
