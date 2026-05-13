/* eslint-disable no-new-func */
import React from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import classNames from 'classnames';
import { chain, compact, head, set, debounce } from 'lodash';
import { Button, Space, Spin, Modal, Input } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { theme as taskTheme } from '@/models/task';

import Empty from '@/components/Empty';
import Markdown from '@/components/Markdown';
import AntdIcon from '@/components/AntdIcon';

import { IMessage } from '@/typescript/message';

import { getMarkdownTemp1, getMarkdownTemp2, getControlBtns } from './util';

import useRegBotEventHooks from '@/hooks/useRegBotEventHooks';

import { ITask } from '@/typescript/task';

import styles from './index.module.less';

export type IProps = {
  taskId?: string;
  loadSsoIframeUrl?: string;
  botProps: any;
  theme?: string;
  message?: Partial<IMessage>;
  getTodoItem?: () => ITask;
};

const CompInMarkdown = ({
  botProps,
  onBtnClick,
  theme = taskTheme[0],
}: {
  botProps: any;
  onBtnClick: (clickInfo: any, data: any) => void;
  theme?: string;
}) => {
  const intl = useIntl();
  const { parameters, disabledBIds, myControlBtns = getControlBtns() } = botProps || {};

  const inputRef = React.useRef<string>('');

  const markdownText = React.useMemo(() => {
    let markdownTemp = getMarkdownTemp1();
    if (parameters.downloadUrl) {
      markdownTemp = getMarkdownTemp2();
    }

    let t = '';
    try {
      const templateFunc = new Function('parameters', 'dayjs', ` return \`${markdownTemp}\`; `);
      t = templateFunc(parameters, dayjs);
    } catch (e) {
      console.log(e);
    }
    return t;
  }, [parameters]);

  const buttonList = React.useMemo(() => {
    return compact(
      myControlBtns.map((btns) => {
        const { display, buttonName, style, icon, event, bId, isDisabled } = btns;

        let canShow = false;
        try {
          //
          const templateFunc = new Function('root', ` return ${display}; `);
          canShow = templateFunc(parameters);
        } catch (e) {
          console.error(e);
        }

        if (canShow) {
          return (
            <Button
              disabled={disabledBIds.includes(bId) || isDisabled} // isEmpty: 兼容旧数据（bot组件用）, 应该只是 disabledBIds.includes
              size="small"
              type={style}
              icon={icon ? <AntdIcon type={icon} /> : undefined}
              onClick={() => {
                const eventItem = head(event) as any;
                if (!eventItem) return;

                const { code, content, params } = eventItem;

                const clickInfo = {
                  type: code,
                  value: content,
                  bId,
                };
                const data = {};

                (params?.children || []).forEach((child: any) => {
                  const { name, value } = child;

                  let val;
                  try {
                    const templateFunc = new Function(
                      'pageParams',
                      ` return ${chain(value).trimStart('${').trimEnd('}').value()}; `
                    );
                    val = templateFunc(parameters);
                  } catch (e) {
                    console.error(e);
                  }

                  set(data, name, val);
                });

                if (clickInfo.value === 'authNotPass') {
                  inputRef.current = '';
                  Modal.confirm({
                    title: intl.formatMessage({ id: 'common.approvalOpinion' }),
                    icon: null,
                    content: (
                      <Input.TextArea
                        rows={4}
                        style={{ resize: 'none' }}
                        onChange={(e) => {
                          inputRef.current = e.target.value;
                        }}
                      />
                    ),
                    onOk: () => {
                      onBtnClick(clickInfo, {
                        ...data,
                        approvalContent: inputRef.current,
                      });
                    },
                  });
                } else {
                  onBtnClick(clickInfo, data);
                }
              }}
              key={bId}
            >
              {buttonName}
            </Button>
          );
        }

        return <React.Fragment key={bId} />;
      })
    );
  }, [parameters]);

  if (!markdownText) return <Empty />;

  return (
    <div className={styles.markdownRender}>
      <div className={classNames(styles.icon, 'ub ub-ac ub-pc float-left')} style={{ background: `${theme}26` }}>
        <AntdIcon type="icon-huihua-fill" style={{ color: `${theme}` }} />
      </div>
      <Markdown markdownClass={styles.markdown} text={markdownText} />
      <div style={{ position: 'absolute', right: 0, bottom: 0 }}>
        <Space size="small">{buttonList}</Space>
      </div>
    </div>
  );
};

function BeyondRender(props: IProps) {
  const { botProps = {}, taskId, loadSsoIframeUrl, theme = taskTheme[0], message, getTodoItem } = props;

  const [spinning, setSpinning] = React.useState(false);

  const { PortalComp, ...eventHooks } = useRegBotEventHooks({
    taskId,
    setSpinning,
    loadSsoIframeUrl,
    message,
    getTodoItem,
  });

  const onBtnClick = React.useCallback(
    debounce((clickInfo: any, data: any) => {
      console.log('*******************onBtnClick', clickInfo, data);
      const { type } = clickInfo;
      eventHooks[type]?.(data, clickInfo);
    }, 300),
    [eventHooks]
  );

  return (
    <>
      <div
        className={styles.beyondRender}
        style={{
          background: `linear-gradient(180deg, ${theme}10 0%, #fff 50%)`,
        }}
      >
        <Spin spinning={spinning}>
          <CompInMarkdown botProps={botProps} onBtnClick={onBtnClick} key={taskId} theme={theme} />
        </Spin>
      </div>
      {PortalComp && createPortal(PortalComp, document.body)}
    </>
  );
}
export default BeyondRender;
