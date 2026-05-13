/* eslint-disable no-new-func */
import React, { useMemo } from 'react';
// @ts-ignore
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { ITaskState } from '@/models/task';
import type { ITask } from '@/typescript/task';
import InfiniteScroll from 'react-infinite-scroll-component';
import { debounce, get, compact, head, chain, set } from 'lodash';
import { Button, ConfigProvider, Input, List, Spin } from 'antd';
import styles from './style.less';
import { getControlBtns } from '@/components/MessagesComp/MyBot/Renderer/util';
import AntdIcon from '@/components/AntdIcon';
import useRegBotEventHooks from '@/hooks/useRegBotEventHooks';
import { ButtonType } from 'antd/es/button';
import classNames from 'classnames';

export default function TodoList() {
  const dispatch = useDispatch();
  const intl = useIntl();
  const abortController = React.useRef<AbortController>(undefined);

  const { loading, tohandleList, tohandlePagination } = useSelector(({ task }: { task: ITaskState }) => ({
    tohandleList: task.tohandleList,
    loading: task.tohandleLoading,
    tohandlePagination: task.tohandlePagination,
  }));

  const { total, pageIndex } = tohandlePagination;

  const hasMore = React.useMemo(() => {
    return tohandleList.length < total;
  }, [tohandleList, total]);

  const getListTasksByPage = React.useCallback(
    debounce((pageNum: number, param: Record<string, unknown> = {}) => {
      if (abortController.current) {
        abortController.current.abort();
      }

      abortController.current = new AbortController();
      dispatch({
        type: 'task/queryTohanleList',
        payload: {
          pageNum,
          ...param,
          queryOpt: {
            cancelToken: abortController.current,
          },
        },
      });
    }, 300),
    []
  );

  const onSearch = React.useCallback(
    (param?: Record<string, unknown>) => {
      dispatch({
        type: 'task/cleanTohanleList',
      });
      getListTasksByPage(1, param);
    },
    [getListTasksByPage]
  );

  return (
    <Spin spinning={loading}>
      <div className={classNames(styles.header, 'ub ub-ac ub-pj')}>
        <span>
          <span role="img" aria-label="bell">
            🔔
          </span>
          {intl.formatMessage({ id: 'chat.bottomContent.todoList.title' })}
        </span>
        <div>
          <Input.Search
            allowClear
            placeholder={intl.formatMessage({ id: 'todo.placeholder' })}
            onSearch={(value) => onSearch({ title: value })}
          />
        </div>
      </div>
      <InfiniteScroll
        hasMore={hasMore}
        scrollableTarget="chat_scroller"
        dataLength={tohandleList.length}
        next={() => getListTasksByPage(pageIndex + 1, {})}
        loader={
          <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
            <Spin spinning={loading} />
          </div>
        }
        scrollThreshold="50px"
        style={{
          overflow: 'visible',
        }}
      >
        <ConfigProvider
          theme={{
            token: {
              fontSize: 12,
              paddingXS: 2,
            },
            components: {
              Button: {
                lineHeight: 1.66,
              },
            },
          }}
        >
          <List
            split={false}
            dataSource={tohandleList}
            className={styles.list}
            renderItem={(item) => (
              // eslint-disable-next-line @typescript-eslint/no-use-before-define
              <ListItem task={item} key={item.taskId} />
            )}
          />
        </ConfigProvider>
      </InfiniteScroll>
    </Spin>
  );
}

function ListItem({ task }: { task: ITask }) {
  const [spinning, setSpinning] = React.useState(false);
  const intl = useIntl();

  const eventHooks = useRegBotEventHooks({
    setSpinning,
    taskId: String(task.taskId),
    message: {
      messageId: `${task.messageId}`,
    },
    loadSsoIframeUrl: task.loadSsoIframeUrl,
  });

  const tagName = useMemo(() => {
    const downloadUrl = get(task, 'resPageObj.downloadUrl');
    if (downloadUrl) {
      return intl.formatMessage({ id: 'common.fileDownload' });
    }
    return get(task, 'resPageObj.flow.PROC_DEF_NAME', '');
  }, [task]);

  const title = useMemo(() => {
    const downloadUrl = get(task, 'resPageObj.downloadUrl');
    if (downloadUrl) {
      return <a href={downloadUrl}>{intl.formatMessage({ id: 'common.clickToDownload' })}</a>;
    }
    return `${get(task, 'resPageObj.flow.PROC_INST_ID')} ${get(task, 'resPageObj.flow.FLOW_NAME', '')}`;
  }, [task]);

  const description = useMemo(() => {
    const { CREATE_STAFF_CODE_NAME, CHECK_USER, TASK_START_TIME } = get(task, 'resPageObj.flow', {});
    const arr: string[] = [];
    if (CREATE_STAFF_CODE_NAME) {
      arr.push(`${intl.formatMessage({ id: 'chat.bottomContent.todoList.initiator' })}: ${CREATE_STAFF_CODE_NAME}`);
    }
    if (CHECK_USER) {
      arr.push(`${intl.formatMessage({ id: 'chat.bottomContent.todoList.handler' })}: ${CHECK_USER}`);
    }
    if (TASK_START_TIME) {
      arr.push(`${intl.formatMessage({ id: 'chat.bottomContent.todoList.time' })}: ${TASK_START_TIME}`);
    }
    return arr.map((str) => <span key={str}>{str}</span>);
  }, [task]);

  const actionBtns = useMemo(() => {
    return compact(
      getControlBtns().map((btns) => {
        const { display, buttonName, style, icon, event, bId } = btns;
        const disabledBIds: string[] = task.resPageObj?.disabledBIds ?? [];

        let canShow = false;
        try {
          //
          const templateFunc = new Function('root', ` return ${display}; `);
          const { resPageObj } = task;
          const root = {
            ...(resPageObj || {}),
            flow: {
              ...(resPageObj?.flow || {}),
              FLOW_STATUS: '00X',
            },
          };
          canShow = templateFunc(root);
        } catch (e) {
          console.error(e);
        }

        if (canShow) {
          return (
            <Button
              key={bId}
              disabled={disabledBIds.includes(bId)} // isEmpty: 兼容旧数据（bot组件用）, 应该只是 disabledBIds.includes
              size="small"
              type={style as ButtonType}
              icon={icon ? <AntdIcon type={icon} /> : undefined}
              onClick={() => {
                const eventItem = head(event as any) as any;
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
                    val = templateFunc(task.resPageObj || {});
                  } catch (e) {
                    console.error(e);
                  }

                  set(data, name, val);
                });
                eventHooks[clickInfo.type]?.(data, clickInfo);
              }}
            >
              {buttonName}
            </Button>
          );
        }

        return null;
      })
    );
  }, [task, spinning]);

  return (
    <Spin spinning={spinning}>
      <List.Item className={styles.item} actions={actionBtns}>
        <List.Item.Meta
          title={
            <div className="ub ub-ac">
              <div className={styles.defName}>{tagName}</div>
              <div className="ub-f1 textEllipsis">{title}</div>
            </div>
          }
          description={<div className="ub ub-ac gap16">{description}</div>}
        />
      </List.Item>
    </Spin>
  );
}
