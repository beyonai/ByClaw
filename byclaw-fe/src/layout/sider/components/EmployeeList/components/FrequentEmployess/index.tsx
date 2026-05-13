import React, {
  useCallback,
  useEffect,
  useState,
  useReducer,
  forwardRef,
  useImperativeHandle,
  useContext,
} from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Divider, List, Skeleton, Spin } from 'antd';
import classNames from 'classnames';
import { noop, pullAllBy, isEmpty, size } from 'lodash';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { queryMyUsual } from '@/service/digitalEmployees';
import InfiniteScroll from '@/components/InfiniteScroll';
import { IAgent, IAgentCache } from '@/typescript/agent';
import withDrag, { DragType } from '@/components/QueryInput/withDrag';
import EmployeeCard from '@/layout/sider/components/EmployeeList/EmployeeCard';
import { agentHandler } from '@/utils/agent';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import useGlobal from '@/hooks/useGlobal';
import EmptyTips from '@/components/EmptyTips';
import { EmployeeListProps, EmployeeListContext, isInputMode } from '@/layout/sider/components/EmployeeList';
import { sortBySuperHelperFirst } from '@/layout/sider/components/EmployeeList/util';

import pStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import { Platform } from '@/layout/components/provider/global';
import { agentTypeMap } from '@/constants/agent';

const Draggble = withDrag(DragType.digitalEmployee);

function isCanceledError(error: unknown) {
  return (error as { name?: string })?.name === 'CanceledError';
}

type IProps = {
  searchName?: string;
} & EmployeeListProps;

const FrequentEmployees = (props: IProps, ref: any) => {
  const { onSelect, searchName } = props;

  const intl = useIntl();
  const { EventEmitter, platform } = useGlobal();
  const { chatMode } = useContext(EmployeeListContext);
  const abortControllerRef = React.useRef<AbortController>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [employeesList, setEmployeesList] = useState<any[]>([]);

  const [paginationInfo, paginationDispatch] = useReducer(
    paginationReducer,
    getDefaultPagination({
      pageSize: 30,
    })
  );
  const [hasMore, setHasMore] = useState(false);

  const { pageSize } = paginationInfo;
  const isMobile = platform === Platform.mobile;
  const isInput = isInputMode(chatMode);
  const myGetAllEmployees = useCallback(
    (param: { pageIndex: number; searchName?: string }) => {
      const { pageIndex, searchName } = param;

      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      return queryMyUsual(
        {
          pageNum: pageIndex,
          pageSize,
          keyword: searchName,
          terminals: ['ALL', isMobile ? 'APP' : 'PC'],
        },
        abortController
      )
        .then((res) => {
          if (res) {
            const { list, ...pageInfo } = res;
            // 联网搜索数字员工不能被手动@出来，只能通过点击按钮切换
            const employeeList = (list || [])
              .map(agentHandler)
              .filter((item: IAgent) => item.agentType !== agentTypeMap.networkSearch);

            if (pageIndex === 1) {
              setEmployeesList(sortBySuperHelperFirst(employeeList));
            } else {
              setEmployeesList((prev) => sortBySuperHelperFirst([...prev, ...employeeList]));
            }

            setHasMore(size(list) >= pageSize);

            paginationDispatch({
              type: 'change',
              item: {
                pageIndex: pageInfo.pageNum,
                total: pageInfo.total,
              },
            });
          }
        })
        .catch((error) => {
          if (isCanceledError(error)) {
            return;
          }
          throw error;
        })
        .finally(() => {
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
          }
        });
    },
    [isMobile]
  );

  const getSearch = React.useCallback((searchKey: string | undefined) => {
    setIsLoading(true);

    myGetAllEmployees({
      pageIndex: 1,
      searchName: searchKey,
    })
      .catch(noop)
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    getSearch(searchName);
    return () => {
      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handler = (param: {
      delIdList?: string[];
      unApplyList?: string[];
      pinList?: string[];
      unpinList?: string[];
      updateList?: Partial<IAgentCache>[];
    }) => {
      const { delIdList = [], unApplyList = [], pinList = [], unpinList = [], updateList = [] } = param || {};
      setEmployeesList((prevList) => {
        // 处理删除和取消关注
        pullAllBy(
          prevList,
          [...delIdList, ...unApplyList].map((agentId) => ({ agentId })),
          'agentId'
        );

        // pinList置顶数据，unpinList取消置顶数据
        if (!isEmpty(pinList) || !isEmpty(unpinList)) {
          const newList = [...prevList];
          // 置顶：将pinList中的数据放在第一条
          if (!isEmpty(pinList)) {
            pinList.forEach((agentId) => {
              const targetIndex = newList.findIndex((item) => `${item.agentId}` === `${agentId}`);
              if (targetIndex > -1) {
                const target = newList.splice(targetIndex, 1)[0];
                newList.unshift({ ...target, isTop: '1' });
              }
            });
          }

          // 取消置顶：找到非置顶数据，将unpinList中的数据放在该数据前面
          if (!isEmpty(unpinList)) {
            const firstUnpinnedIndex = newList.findIndex((item) => `${item.isTop}` === '0');
            if (firstUnpinnedIndex > -1) {
              unpinList.forEach((agentId) => {
                const targetIndex = newList.findIndex((item) => `${item.agentId}` === `${agentId}`);
                if (targetIndex > -1) {
                  const target = newList.splice(targetIndex, 1)[0];
                  // 确保不小于0
                  const insertIndex = Math.max(0, firstUnpinnedIndex - 1);
                  newList.splice(insertIndex, 0, { ...target, isTop: '0' });
                }
              });
            }
          }

          return newList;
        }

        if (!isEmpty(updateList)) {
          updateList.forEach((item) => {
            const target = prevList.find((targetItem) => `${targetItem.agentId}` === `${item.agentId}`);
            if (target) {
              Object.assign(target, item);
            }
          });
        }

        return [...prevList];
      });
    };
    EventEmitter.on('beyond-update-employee', handler);
    return () => {
      EventEmitter.off('beyond-update-employee', handler);
    };
  }, [EventEmitter]);

  useImperativeHandle(
    ref,
    () => ({
      getSearch,
    }),
    []
  );

  return (
    <DndProvider backend={HTML5Backend}>
      {isLoading && (
        <div className="ub ub-ac ub-pc full-height">
          <Spin spinning />
        </div>
      )}
      {!isLoading && (
        <div
          id="frequentEmployeeListWrap"
          className={classNames('full-height overflow-auto', {
            hideThumb: !isInput,
          })}
        >
          <InfiniteScroll
            next={() => {
              myGetAllEmployees({
                pageIndex: paginationInfo.pageIndex + 1,
                searchName,
              });
            }}
            hasMore={hasMore}
            dataLength={employeesList.length}
            hasChildren={employeesList.length > 0}
            loader={
              <Skeleton avatar={{ size: 'default', shape: 'circle' }} paragraph={false} active style={{ padding: 8 }} />
            }
            endMessage={
              employeesList.length > 0 && (
                <Divider plain>
                  {intl.formatMessage({ id: 'common.endMessage' })}{' '}
                  <span role="img" aria-label="emoji">
                    🤐
                  </span>
                </Divider>
              )
            }
            scrollableTarget="frequentEmployeeListWrap"
            inverse={false}
            scrollThreshold="50px"
            style={{ overflow: 'visible', paddingBottom: hasMore ? '20px' : 0 }}
          >
            <List
              className={pStyles.employeesList}
              dataSource={employeesList}
              split={false}
              renderItem={(item: any) => {
                const canDrag = true;
                return (
                  <Draggble data={item} key={item.agentId} disabled={!canDrag}>
                    <EmployeeCard
                      key={item?.agentId}
                      employee={item}
                      onSelect={onSelect || noop}
                      renderActionIcon={props.renderActionIcon}
                      disabledAction={['pin', 'unpin']}
                    />
                  </Draggble>
                );
              }}
              locale={{
                emptyText: (
                  <EmptyTips
                    icon="️🫥"
                    title={intl.formatMessage({ id: 'employees.listTitle' })}
                    description={intl.formatMessage({ id: 'employees.listDesc' })}
                  />
                ),
              }}
            />
          </InfiniteScroll>
        </div>
      )}
    </DndProvider>
  );
};

export default forwardRef(FrequentEmployees);
