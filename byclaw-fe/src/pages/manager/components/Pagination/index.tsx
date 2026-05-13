import React from 'react';
import { Checkbox, Pagination as AntdPagination } from 'antd';
import classnames from 'classnames';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

const PAGE_SIZE_OPTIONS = ['5', '10', '20', '50', '100'];

const remakePageSizeOptions = (originOptions: any, pageSize: number | undefined) => {
  if (!originOptions.includes(`${pageSize}`)) {
    originOptions.push(`${pageSize}`); // 这里要string
    originOptions.sort((a: string, b: string) => {
      return parseInt(a, 10) - parseInt(b, 10);
    });
  }

  return Array.from(new Set(originOptions));
};

const getDefaultPageSizeOptions = (pageSize: number | undefined) => {
  const options = remakePageSizeOptions(Array.from(PAGE_SIZE_OPTIONS), pageSize);

  return Array.from(new Set(options));
};

export type paginationPropsType = {
  pageSizeOptions?: any;
  onShowSizeChange?: (current: number, size: number) => void;
  onChange?: (current: number, size: number) => void;
  showQuickJumper?: boolean;
  showSizeChanger?: boolean;
  pageSize?: number;
  current?: number;
  pageIndex?: number;
  total?: number;
  showSelectInf?: boolean | undefined;
};

export type Props = {
  selectKeysList?: React.Key[];
  pageAllCount?: number;
  selectAllChange?: (e: any) => void;
  pagination?: paginationPropsType & {
    checkedProps?: any;
    hideCheck?: boolean;
  };
  muiltDisable?: boolean | (() => boolean);
  paginationBorderBox?: string;
  tableFooterBox?: string;
  mulitBtnList?: { disabled?: boolean; value: string; label: string }[];
  showMuit?: boolean;
  checkAll?: boolean;
  indeterminate?: boolean;
  footerRender?: () => React.ReactNode;
  showPagination?: boolean;
};

const Pagination = (props: Props) => {
  const {
    selectKeysList = [],
    pageAllCount = 0,
    selectAllChange,
    mulitBtnList = [],
    pagination = {},
    footerRender,
    tableFooterBox,
    showMuit: showMuitProps,
    paginationBorderBox,
    showPagination = true,
    ...otherProps
  } = props;

  const intl = useIntl();

  const selectCount = selectKeysList.length;
  let checked = !!selectCount && selectCount === pageAllCount;
  let indeterminate = !!selectCount && selectCount < pageAllCount;
  const showMuit = !!footerRender || !!mulitBtnList.length || showMuitProps;
  const { checkedProps, showSelectInf = true, onChange, hideCheck = false, ...otherPagination } = pagination;
  if (checkedProps) {
    ({ checked, indeterminate } = checkedProps);
  }
  const paginationProps: paginationPropsType = {
    showQuickJumper: true,
    showSizeChanger: true,
    onChange,
    ...otherPagination,
  };
  if (!paginationProps.pageSizeOptions) {
    paginationProps.pageSizeOptions = getDefaultPageSizeOptions(paginationProps.pageSize);
  } else {
    const { pageSize, pageSizeOptions } = paginationProps;
    paginationProps.pageSizeOptions = remakePageSizeOptions(pageSizeOptions, pageSize);
  }

  return (
    <React.Fragment>
      <div className={classnames(styles.borderBox, paginationBorderBox)} />
      <div className={classnames(styles.pageContainer, tableFooterBox)}>
        <div className={styles.pageSelect}>
          {showSelectInf && (
            <div>
              {!hideCheck && (
                <Checkbox indeterminate={indeterminate} checked={checked} onChange={selectAllChange}>
                  {intl.formatMessage({ id: 'pagination.selectAll' })}
                </Checkbox>
              )}
              <span className={styles.checkInfo}>
                {intl.formatMessage({ id: 'pagination.selected' })}
                <span className={styles.selectCount}>{selectCount}</span>
                {intl.formatMessage({ id: 'pagination.items' })}
              </span>
            </div>
          )}
          {showMuit && <div className="margin-left-10">{footerRender && footerRender()}</div>}
        </div>
        {showPagination && (
          <AntdPagination
            size="small"
            showTotal={(total: number) => intl.formatMessage({ id: 'pagination.total' }, { total })}
            {...paginationProps}
            {...otherProps}
          />
        )}
      </div>
    </React.Fragment>
  );
};
export default Pagination;
