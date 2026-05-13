import AntdIcon from '@/components/AntdIcon';
import ShareTagItem from '@/components/shareTagItem';
import { areaList } from '@/constants/knowledgeCenter';
import { CheckOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import classNames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';
import React, { useState } from 'react';
import styles from './index.module.less';

type VisibleRangeEditProps = {
  onCancel: () => void;
  onOk: () => void;
  info: any;
};

const VisibleRange = (props: VisibleRangeEditProps) => {
  const { onCancel, onOk, info } = props;

  const [selectArea, setSelectArea] = useState<string>(`${info.shareRange}`);
  const intl = useIntl();
  const [memberSelect, setMemberSelect] = useState(false);
  const [selectMember, setSelectMember] = useState<any[]>([]);
  console.log(memberSelect);

  return (
    <Modal
      title={intl.formatMessage({ id: 'knowledgeCenter.visibleRange.editTitle' })}
      open
      onCancel={onCancel}
      onOk={onOk}
      width={560}
    >
      <div className={styles.title}>{intl.formatMessage({ id: 'knowledgeCenter.visibleRange.publicRange' })}</div>
      <div className={styles.radio} style={{ marginBottom: selectArea === '2' ? 8 : 16 }}>
        {areaList?.map((item) => (
          <div
            key={item.key}
            className={classNames(styles.item, item.key === selectArea && styles.active)}
            onClick={() => {
              setSelectArea(`${item.key}`);
            }}
          >
            {item.key === selectArea && (
              <div className={styles.check}>
                <CheckOutlined />
              </div>
            )}
            <div className={styles.icon}>
              <AntdIcon type={item.icon} style={{ fontSize: 20 }} />
            </div>
            <div className={styles.itemTitle}>{item.title}</div>
            <div className={styles.subTitle}>{item.subTitle}</div>
          </div>
        ))}
      </div>
      {selectArea === '2' && selectMember?.length === 0 && (
        <Button
          type="link"
          icon={<AntdIcon type="icon-a-People-plus-onetianjiarenqun" />}
          style={{ padding: '8px 0px', marginBottom: 16 }}
          onClick={() => {
            setMemberSelect(true);
          }}
        >
          {intl.formatMessage({ id: 'knowledgeCenter.visibleRange.addMember' })}
        </Button>
      )}
      {selectArea === '2' && selectMember?.length > 0 && (
        <div className={classNames(styles.shareTagList, 'overflow-auto hideThumb')}>
          {selectMember.map((item: any) => (
            <ShareTagItem
              item={item}
              key={item.value}
              onClose={() => {
                setSelectMember(selectMember.filter((ele) => ele.value !== item.value));
              }}
            />
          ))}
          <div
            className={styles.addBtn}
            onClick={() => {
              setMemberSelect(true);
            }}
          >
            <AntdIcon type="icon-a-Plusjia" style={{ fontSize: 16 }} />
            {intl.formatMessage({ id: 'common.add' })}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default VisibleRange;
