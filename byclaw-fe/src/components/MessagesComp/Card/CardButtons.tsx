/**
 * 卡片按钮组件
 * 负责渲染卡片底部按钮区域
 */
import React, { useCallback, useState, useContext } from 'react';
import { Button, Space } from 'antd';
import classnames from 'classnames';
import { CardComponentContext } from './index';
import styles from './index.module.less';
import { CardActionType, ICardButton } from './types';

interface CardButtonsProps {
  buttons?: ICardButton[];
  buttonStatus?: Array<Partial<ICardButton>>;
}

const CardButtons: React.FC<CardButtonsProps> = ({ buttons, buttonStatus }) => {
  const [loadingButtons, setLoadingButtons] = useState<Set<number>>(new Set());

  const { executeAction } = useContext(CardComponentContext);

  const handleButtonClick = useCallback(
    async (button: ICardButton, index: number) => {
      if (button.disabled) {
        return;
      }

      const { action } = button;
      // 如果按钮需要显示加载状态
      if (action?.type === CardActionType.FETCH) {
        const { showLoading = true } = action;
        if (showLoading) {
          setLoadingButtons((prev) => new Set(prev).add(index));
        }
      }

      try {
        await executeAction(button.action);
      } catch (error) {
        console.error('Button action failed:', error);
      } finally {
        // 清除加载状态
        if (button.action?.type === CardActionType.FETCH) {
          setLoadingButtons((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
          });
        }
      }
    },
    [executeAction]
  );

  if (!buttons || buttons.length === 0) {
    return null;
  }

  return (
    <>
      <div className={styles.cardButtons}>
        <Space size="small" wrap>
          {buttons.map((button, index) => {
            const isLoading = loadingButtons.has(index);
            let { text, disabled } = button;
            let btnInst: Partial<ICardButton> | undefined;
            if (buttonStatus && button.key) {
              if (Array.isArray(buttonStatus)) {
                btnInst = buttonStatus.find((btn) => btn.key === button.key);
              } else if (typeof buttonStatus === 'object') {
                btnInst = buttonStatus[button.key];
              }
              if (btnInst) {
                if (btnInst.text) {
                  ({ text } = btnInst);
                }
                if (typeof btnInst.disabled === 'boolean') {
                  ({ disabled } = btnInst);
                }
              }
            }

            return (
              <Button
                key={button.key || index}
                type={button.type}
                size={button.size}
                disabled={disabled}
                loading={isLoading}
                className={classnames(styles.cardButton)}
                style={button.style}
                onClick={() => handleButtonClick(button, index)}
              >
                {text}
              </Button>
            );
          })}
        </Space>
      </div>
    </>
  );
};

export default CardButtons;
