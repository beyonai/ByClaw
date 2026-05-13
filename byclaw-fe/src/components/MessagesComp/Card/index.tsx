/**
 * 通用卡片组件
 * 根据ICardConfig配置渲染卡片内容
 */
import React, { useCallback, useMemo, createContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from 'antd';
import classnames from 'classnames';
import type { ICardConfig, ICardButton } from './types';
import { useCardAction } from './useCardAction';
import CardTitle from './CardTitle';
import CardContent from './CardContent';
import CardButtons from './CardButtons';
import { ICardAction } from './types';
import styles from './index.module.less';

type IProps = {
  messageListItemContent: {
    substance: string;
  };
};

type IConfig = ICardConfig & {
  buttonStatus?: Array<Partial<ICardButton>>;
};

type ICardContext = {
  executeAction: (action: ICardAction) => void;
};

export const CardComponentContext = createContext<ICardContext>({
  executeAction: () => {},
});

const CardComponent = (props: IProps) => {
  const { messageListItemContent } = props;
  const { substance } = messageListItemContent;

  const [portalContainer, setPortalContainer] = useState<React.ReactNode>(null);

  const { executeAction } = useCardAction({
    setPortalContainer,
  });

  // message参数保留在props中，供未来扩展使用

  // 解析卡片配置
  const cardConfig = useMemo<IConfig | null>(() => {
    if (typeof substance === 'string') {
      try {
        const parsed = JSON.parse(substance);
        return parsed as IConfig;
      } catch (error) {
        console.error(error);
        return null;
      }
    }

    if (typeof substance === 'object' && substance !== null) {
      return substance as IConfig;
    }

    return null;
  }, [substance]);

  // 处理卡片点击
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // 如果点击的是按钮区域，不触发卡片点击
      if ((e.target as HTMLElement).closest(`.${styles.cardButtons}`)) {
        return;
      }

      if (cardConfig?.action) {
        e.stopPropagation();
        executeAction(cardConfig.action);
      }
    },
    [cardConfig, executeAction]
  );

  if (!cardConfig) {
    return null;
  }

  const { title, content, buttons, action, style } = cardConfig;

  return (
    <>
      <CardComponentContext.Provider value={{ executeAction }}>
        <div className={classnames(styles.cardWrapper)} style={style}>
          <Card
            className={classnames(styles.card)}
            onClick={action ? handleCardClick : undefined}
            styles={{
              body: {
                padding: 0,
              },
            }}
          >
            {/* 标题区域 */}
            <CardTitle title={title} />

            {/* 内容区域 */}
            <CardContent content={content} />

            {/* 按钮区域 */}
            <CardButtons buttons={buttons} buttonStatus={cardConfig.buttonStatus} />
          </Card>
        </div>
      </CardComponentContext.Provider>
      {portalContainer && createPortal(portalContainer, document.body)}
    </>
  );
};

export default CardComponent;
