import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { Empty, Spin } from 'antd';
import { debounce } from 'lodash';
import Pagination from '@/pages/manager/components/Pagination';
import styles from './index.module.less';

export { default as AddCard } from './Card';
// 这里是一个魔法值：最小的cardWidth + 20 padding
const CARD_WIDTH = 260;

export type paginationProps = {
  current: number;
  showQuickJumper?: boolean;
  showSizeChanger?: boolean;
  showSelectInf?: any;
  onChange?: (pi: number, pz: number, otherParams?: object) => void;
  onShowSizeChange?: (pi: number, pz: number, otherParams?: object) => void;
  pageIndex?: number;
  pageSize: number;
  total: number;
};

interface CardListProps {
  dataSource: any[];
  rowId: string;
  allChecked?: boolean;
  showPagination: boolean;
  loading: boolean;
  autoPageSize?: boolean;
  setScrollY?: boolean;
  mulitBtnList?: any[];
  pagination: paginationProps;
  tableFooterBox?: any;
  callbackFunc?: (list: any) => void;
  onSelect?: (key: any, cardData: any[]) => void;
  onPageChange?: (payload: { pageIndex: number; pageSize: number }) => void;
  cancelSelect?: (key: any) => void;
  cardItemFn: (data: any, cardItemProps: any) => ReactNode;
  selectAll?: (checkKeyList: any[]) => void;
  muiltDisable?: boolean | (() => boolean);
  footerRender?: () => ReactNode;
  cardWidth?: number;
  canSelect?: boolean;
  paginationBorderBox?: string;
  lessPageSize?: boolean;
  itemBoxClass?: string;
}

const CardList = (props: CardListProps) => {
  const {
    cardWidth: propsCardWidth,
    allChecked,
    showPagination,
    pagination: { pageIndex = 1, total } = {},
    pagination,
    dataSource,
    muiltDisable = false,
    mulitBtnList = [],
    rowId,
    loading,
    footerRender,
    tableFooterBox,
    setScrollY = true,
    onSelect,
    autoPageSize = false,
    cardItemFn,
    cancelSelect,
    selectAll,
    callbackFunc,
    onPageChange,
    canSelect = true,
    paginationBorderBox,
    lessPageSize = false,
    itemBoxClass = '',
  } = props;

  const [rowCount, setRowCount] = useState(0);
  const [cardWidth, setCardWidth] = useState(propsCardWidth || CARD_WIDTH);
  const [checkKeysList, setCheckKeysList] = useState<string[]>([]);
  const cardListRef = useRef<HTMLDivElement | null>(null);
  const isEmpty = !dataSource || dataSource.length <= 0;
  // 是否显示底部
  const showFooter = allChecked || showPagination || !!mulitBtnList.length;

  const handlePageChange = (pageIndex: number, pageSize: number) => {
    if (onPageChange) onPageChange({ pageIndex, pageSize });
  };

  const paginationProps = {
    ...pagination,
    onChange: handlePageChange,
    showSelectInf: canSelect,
  };

  const handleResize = () => {
    if (cardListRef && cardListRef.current) {
      const container = cardListRef.current;
      const maxWidth = container.offsetWidth;
      //  切记这里的行数不能依赖当前记录的真实cardWidth，因为其会跟着maxWidth一起变化
      const rowCount = Math.floor((maxWidth - 30) / cardWidth);
      //  每行可放的个数改变了cardWidth一定改变，但cardWidth改变每行可放的个数不一定改变
      setRowCount(rowCount);
      if (cardWidth !== maxWidth / rowCount) {
        setCardWidth(maxWidth / rowCount);
      }
    }
  };

  const handlePageResize = debounce(() => {
    if (autoPageSize && cardListRef.current) {
      //  视口的高度
      const container = cardListRef.current;
      const newBoxHeight = container.clientHeight;
      if (rowCount && cardWidth) {
        //  初始化则选择用默认的5：4的比例来初始化cardHeight
        const cardHeight = (cardWidth / 5) * 4;
        //  视口可以放多少列
        const colCount = Math.ceil(newBoxHeight / cardHeight);
        const pageSize = colCount * rowCount;
        //  处理页面大小变化时可能出现当前页码超过最大页码的问题，total为0时直接用pageIndex
        let newPageIndex = pageIndex || 1;
        if (total && total < pageSize * (pageIndex - 1)) {
          newPageIndex = Math.ceil(total / pageSize);
        }
        //  pageSize最小为1，避免在请求页面的时候出现除0异常
        handlePageChange(newPageIndex, lessPageSize ? pageSize - 1 : pageSize || 1);
      }
    }
  }, 300);

  const resize = debounce(() => {
    handleResize();
  }, 300);

  // 选中
  const handleClick = (cardData: any) => {
    const key = cardData[rowId];
    const list = [...checkKeysList, key];
    setCheckKeysList(list);
    if (callbackFunc) callbackFunc(list);
    if (onSelect) onSelect(key, cardData);
  };

  // 取消选中
  const handleCheckClick = (cardData: any) => {
    const key = cardData[rowId];
    const list = checkKeysList.filter((itemKey: any) => itemKey !== key);
    setCheckKeysList(list);
    if (callbackFunc) callbackFunc(list);
    if (cancelSelect) cancelSelect(key);
  };

  // 全选
  const allCardChecked = (e: any) => {
    const { checked } = e.target;
    let checkKeysList: any = [];
    if (checked) {
      checkKeysList = dataSource.map((data) => data[rowId]);
    }
    setCheckKeysList(checkKeysList);
    if (callbackFunc) callbackFunc(checkKeysList);
    if (selectAll) selectAll(checkKeysList);
  };

  // 渲染Item
  const handleRenderCardItem = useCallback(
    (data: any) => {
      const key = data[rowId];
      const cardItemProps = {
        onClick: handleClick,
        checkClick: handleCheckClick,
        checked: checkKeysList.indexOf(key) >= 0,
      };
      return cardItemFn(data, cardItemProps);
    },
    [checkKeysList, cardItemFn, rowId]
  );

  useEffect(() => {
    handlePageResize();
  }, [cardWidth, rowCount]);

  useEffect(() => {
    if (setScrollY) {
      resize();
    }
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  // 清空勾选
  useEffect(() => {
    setCheckKeysList([]);
  }, [dataSource]);
  return (
    <div className={classnames('fullHeight', styles.cardList)}>
      <Spin spinning={loading} wrapperClassName={showFooter ? styles.cutPage : 'fullHeight'}>
        <div
          className={styles.tab}
          ref={cardListRef}
          style={{
            flex: 1,
          }}
        >
          {!isEmpty ? (
            <div className={classnames(styles.itemBox, itemBoxClass)}>
              {dataSource.map((object, idx) => {
                return (
                  <div
                    className={styles.item}
                    key={object[rowId] || `${object[rowId]}_${idx}`}
                    style={{ width: `${100 / rowCount}%` }}
                  >
                    {handleRenderCardItem(object)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyContent}>
              <Empty />
            </div>
          )}
        </div>
      </Spin>
      {!isEmpty && showFooter && (
        <div className={classnames(styles.bulkOperation)}>
          <Pagination
            showMuit
            pageAllCount={dataSource.length}
            selectKeysList={checkKeysList}
            selectAllChange={allCardChecked}
            muiltDisable={muiltDisable}
            mulitBtnList={mulitBtnList}
            footerRender={footerRender}
            tableFooterBox={tableFooterBox}
            pagination={paginationProps}
            paginationBorderBox={paginationBorderBox || styles.paginationBorderBox}
          />
        </div>
      )}
    </div>
  );
};

export default CardList;
