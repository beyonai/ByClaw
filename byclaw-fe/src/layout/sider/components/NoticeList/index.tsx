import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import AntdIcon from '@/components/AntdIcon';
import { Badge, Popover, Segmented, Button, Typography } from 'antd';
import classnames from 'classnames';
import { isEmpty } from 'lodash';
import { CloseCircleFilled } from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useSelector, useIntl, getIntl } from '@umijs/max';

import AllNoticeList from './components/AllNoticeList';
import UnreadNoticeList from './components/UnreadNoticeList';

import type { INoticeItem } from '@/models/notice';

import styles from './index.module.less';

const { Paragraph } = Typography;
interface NoticeListProps {
  style?: React.CSSProperties; // 添加此行以支持 style 属性
}

const AllTabValue = 'all';
const UnreadTabValue = 'unread';

const NoticeListOptions = [
  {
    label: getIntl().formatMessage({ id: 'notice.all' }),
    value: AllTabValue,
  },
  {
    label: getIntl().formatMessage({ id: 'notice.unread' }),
    value: UnreadTabValue,
  },
];

const NoticeList: React.FC<NoticeListProps> = ({ style }) => {
  const intl = useIntl();
  const dispatch = useDispatch();

  const { unreadNoticeList } = useSelector(({ notice }) => ({
    unreadNoticeList: notice.unreadNoticeList || [],
  }));

  const show = unreadNoticeList?.length > 0;

  const [activeTab, setActiveTab] = useState<string>(AllTabValue);

  const [proactiveShow, setProactiveShow] = useState<boolean>(true);
  const [proactiveList, setProactiveList] = useState<INoticeItem[]>([]);
  const [proactivePage] = useState<number>(0);

  const currentProactiveItem = React.useMemo(() => {
    return proactiveList[proactivePage];
  }, [proactiveList, proactivePage]);

  const handleReadAllNotice = () => {
    dispatch({ type: 'notice/batchReadNotice', payload: { read: 'ALL' } });
  };

  const contentRender = (
    <div className={styles.noticeListContent}>
      {/* 头部 */}
      <div className={classnames(styles.header, 'ub ub-pj ub-ac')}>
        <Segmented options={NoticeListOptions} value={activeTab} onChange={(value) => setActiveTab(value)} />
        <Button
          size="small"
          iconPosition="start"
          icon={<AntdIcon type="icon-a-Add-alltianjia2" className={classnames(styles.clearIcon)} />}
          onClick={() => handleReadAllNotice()}
        >
          {intl.formatMessage({ id: 'notice.batchRead' })}
        </Button>
      </div>
      {/* 列表 */}
      <div className="ub-f1" style={{ display: activeTab === AllTabValue ? 'block' : 'none' }}>
        <AllNoticeList />
      </div>
      <div className="ub-f1" style={{ display: activeTab === UnreadTabValue ? 'block' : 'none' }}>
        <UnreadNoticeList />
      </div>
    </div>
  );

  const proactiveRender = (
    <div style={{ padding: '6px 6px 6px 0', position: 'relative', background: 'transparent' }}>
      <CloseCircleFilled
        style={{ position: 'absolute', right: '1px', top: '1px' }}
        onClick={() => {
          dispatch({ type: 'notice/batchReadNotice', payload: { idList: [currentProactiveItem.id] } });
          setProactiveShow(false);
        }}
      />
      <div className={classnames(styles.proactiveContent, 'ub ub-ver')}>
        <div className="ub gap8 ub-ac" style={{ fontSize: 13, color: 'var(--beyond-color-text-tertiary)' }}>
          <span className="ub-f1 ellipsis">{currentProactiveItem?.title}</span>
        </div>
        <Paragraph ellipsis={{ rows: 3 }} className={styles.cardDesc}>
          {currentProactiveItem?.content}
        </Paragraph>
        <div />
      </div>
    </div>
  );

  useEffect(() => {
    dispatch({ type: 'notice/getAllNotice', payload: { pageNum: 1, isRead: '0' } }).then((res: INoticeItem[]) => {
      setProactiveList(
        res.filter((item) => {
          const { bizType, expireTime } = item;

          const isExpired = dayjs(expireTime).isBefore(dayjs());

          return bizType === '0' && !isExpired;
        })
      );
    });
  }, []);

  return (
    <div className={classnames(styles.noticeListWrap, 'pointer')} style={style}>
      <Popover
        arrow
        content={contentRender}
        placement="right"
        trigger="click"
        destroyOnHidden
        onOpenChange={() => {
          setProactiveShow(false);
        }}
      >
        <Badge dot={show}>
          <AntdIcon type="icon-tongzhi" />
        </Badge>
      </Popover>
      <Popover
        arrow
        content={proactiveRender}
        placement="right"
        trigger="click"
        destroyOnHidden
        open={proactiveShow && !isEmpty(proactiveList)}
        styles={{
          body: {
            background: 'transparent',
            boxShadow: 'none',
            padding: 0,
          },
        }}
      >
        <></>
      </Popover>
    </div>
  );
};

export default NoticeList;
