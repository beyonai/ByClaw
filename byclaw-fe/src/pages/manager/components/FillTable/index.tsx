// @ts-nocheck
/* eslint-disable */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Spin, Table } from 'antd';
import Size from '@/pages/manager/components/ausong/Size';
import { Resizable } from 'react-resizable';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import { getRunner, ToolTipCell } from '@/pages/manager/utils/managerUtils';
import styles from './index.module.less';

const ResizeableTitle = (props) => {
  const { onResize, width, onClick, ...restProps } = props;
  const widthItem = typeof width === 'number' ? width : parseInt(width, 10) || 140;

  return (
    <Resizable
      width={widthItem}
      height={0}
      // onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th
        {...restProps}
        onClick={(e) => {
          if (!e.target.classList.contains('react-resizable-handle')) {
            if (onClick) {
              // 没有调整列宽时才触发 Ant Table 排序
              onClick();
            }
          }
        }}
      />
    </Resizable>
  );
};

function FillTable(props) {
  const {
    children,
    defaultPageSize = 10,
    onResize: propsOnResize,
    headHeight = 40,
    rowHeight = 40,
    columns,
    components: propsComponents,
    otherHeight,
    ...otherProps
  } = props;

  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(50);
  const [pageColumns, setPageColumns] = useState([]);
  const otherHeightRef = useRef(otherHeight);
  otherHeightRef.current = otherHeight;
  const columnWidthsRef = useRef({}); // 用于记录用户调整的列宽

  // 初始化列配置
  useEffect(() => {
    const updatedColumns = columns.map((col) => {
      const width = columnWidthsRef.current[col.key] || col.width || 140; // 优先使用用户调整后的宽度
      return {
        ...col,
        ellipsis: true,
        width,
        render:
          !col.render && !col.tooltipPreserveLineBreak
            ? (text) => (
                <Ellipsis tooltip tooltipProps={col.tooltipProps || {}} lines={1}>
                  {text}
                </Ellipsis>
              )
            : col.render,
      };
    });
    setPageColumns(updatedColumns);
  }, [columns]); // 当 columns 变化时重新初始化，但保留用户的宽度调整

  const [components, setComponents] = useState({
    header: {
      // cell: ResizeableTitle,
      ...propsComponents?.header,
    },
    body: {
      cell: ToolTipCell,
      ...propsComponents?.body,
    },
  });

  function onResize(w, h) {
    setLoading(false);

    const count = Math.max(defaultPageSize, Math.floor((h - headHeight) / rowHeight) + 1);

    if (propsOnResize) {
      propsOnResize({ pageSize: count, w, h });
    }

    const finalHeight = h || document.documentElement.offsetHeight - (otherHeightRef.current || 0);
    if (finalHeight > 0) {
      setHeight(finalHeight);
    }
  }

  const handleResize =
    (key) =>
    (e, { size }) => {
      const nextColumns = pageColumns.map((col) => (col.key === key ? { ...col, width: size.width } : col));
      setPageColumns(nextColumns);
      columnWidthsRef.current[key] = size.width; // 记录用户调整的宽度
    };

  const newColumns = useMemo(() => {
    let hasFixedColumns = false;
    let totalColumnWidth = 0;

    const processedColumns = pageColumns.map((col) => {
      if (col.fixed) {
        hasFixedColumns = true;
      }
      const columnWidth = typeof col.width === 'number' ? col.width : parseInt(col.width, 10) || 140;
      totalColumnWidth += columnWidth;

      return {
        ...col,
        onHeaderCell: (column) => ({
          width: column.width,
          // onResize: handleResize(column.key),
        }),
        onCell: col.tooltipPreserveLineBreak
          ? (...args) => ({
              ...col.onCell?.(...args),
              tooltipPreserveLineBreak: col.tooltipPreserveLineBreak,
            })
          : col.onCell,
      };
    });

    const scrollProps = hasFixedColumns ? { x: totalColumnWidth } : {};
    return { processedColumns, scrollProps };
  }, [pageColumns]);

  const runningInstanceRef = useRef();
  const rootRefRef = useRef();

  useEffect(() => {
    runningInstanceRef.current?.stop();
    runningInstanceRef.current = getRunner(
      () => {
        const tbody = rootRefRef.current?.current?.querySelector(`div.${PREFIX_NAME}-table-body`);
        return !!tbody;
      },
      () => {
        const theader = rootRefRef.current?.current?.querySelector(`div.${PREFIX_NAME}-table-header`);
        const tbody = rootRefRef.current?.current?.querySelector(`div.${PREFIX_NAME}-table-body`);
        if (tbody) {
          tbody.style.minHeight = `${height - (theader?.offsetHeight ?? 100)}px`;
        }
      }
    );
    runningInstanceRef.current.run();

    return () => {
      runningInstanceRef.current?.stop();
      runningInstanceRef.current = null;
    };
  }, [height]);

  return (
    <Size
      onResize={onResize}
      onRootRef={(r) => {
        rootRefRef.current = r;
      }}
    >
      {() =>
        loading ? (
          <Spin />
        ) : (
          <Table
            className={styles.eyTable}
            scroll={{ y: height - 100, ...newColumns.scrollProps }}
            components={components}
            columns={newColumns.processedColumns}
            {...otherProps}
          />
        )
      }
    </Size>
  );
}

export default FillTable;
