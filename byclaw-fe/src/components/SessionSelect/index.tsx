import React, { useState } from 'react';

import { CloseCircleFilled } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Segmented, Modal, Tabs } from 'antd';
import classnames from 'classnames';
import { isEmpty } from 'lodash';

import { dataItemTypeMap } from '@/components/PersonnelModel/const';

import SessionList from './components/sessionList';
import OrgUserSelector from '@/components/OrgUserSelector';
import RightItemRender from '@/components/PersonnelModel/RightItemRender';

import styles from './index.module.less';

type ISelectList = Array<
  {
    key: string;
    type: (typeof dataItemTypeMap)[keyof typeof dataItemTypeMap];
  } & Record<string, unknown>
>;

type IProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onOk: (selectList: ISelectList) => Promise<unknown>;
};

function SessionSelect(props: IProps) {
  const { open, setOpen, onOk } = props;

  const intl = useIntl();

  const [selectList, setSelectList] = React.useState<ISelectList>([]);
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false);
  const [segmented, setSegmented] = useState<'session' | 'communicat'>('session');

  return (
    <Modal
      destroyOnHidden
      open={open}
      style={{ borderRadius: '10px' }}
      onCancel={() => setOpen(false)}
      width={680}
      closable={false}
      styles={{
        header: {
          display: 'none',
        },
        content: { padding: '0px' },
      }}
      footer={null}
    >
      <div className={styles.content}>
        <div className={styles.left}>
          <div className={styles.header}>{intl.formatMessage({ id: 'common.forward' })}</div>
          <div className={classnames(styles.list, 'ub ub-f1 ub-ver')}>
            <Segmented
              options={[
                {
                  label: intl.formatMessage({ id: 'common.session' }),
                  value: 'session',
                },
                {
                  label: intl.formatMessage({ id: 'common.communicate' }),
                  value: 'communicat',
                },
              ]}
              block
              onChange={(value: 'session' | 'communicat') => {
                setSegmented(value);
              }}
              className={styles.Segmented}
            />
            <div className="ub-f1">
              <Tabs activeKey={segmented} className={styles.Tabs}>
                <Tabs.TabPane tab={intl.formatMessage({ id: 'common.session' })} key="session">
                  <SessionList
                    onSelect={(session) => {
                      setSelectList([
                        {
                          ...session,
                          type: dataItemTypeMap.session,
                          name: session.sessionName,
                          key: session.sessionId,
                        },
                      ]);
                    }}
                  />
                </Tabs.TabPane>
                <Tabs.TabPane tab={intl.formatMessage({ id: 'common.communicate' })} key="communicat">
                  <OrgUserSelector
                    disableChat
                    style={{ flex: '1 1 auto', overflow: 'hidden' }}
                    onSelect={(user) => {
                      setSelectList([
                        {
                          ...user,
                          type: dataItemTypeMap.user,
                          name: user.userName,
                          key: user.userId,
                        },
                      ]);
                    }}
                  />
                </Tabs.TabPane>
              </Tabs>
            </div>
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.header}>
            {intl.formatMessage({ id: 'personnelModel.selectedCount' }, { count: selectList.length })}
          </div>
          <div className={styles.selectedList}>
            {selectList.map((item) => (
              <div className={styles.listItem} key={item.key}>
                <RightItemRender item={item} />
                <div
                  className={styles.close}
                  onClick={() => {
                    setSelectList((pre) => pre.filter((i) => i.key !== item.key));
                  }}
                >
                  <CloseCircleFilled />
                </div>
              </div>
            ))}
          </div>
          <div className={styles.btn}>
            <Button onClick={() => setOpen(false)}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button
              onClick={() => {
                if (isEmpty(selectList)) {
                  return;
                }

                setConfirmLoading(true);

                onOk(selectList).finally(() => {
                  setConfirmLoading(false);
                });
              }}
              type="primary"
              loading={confirmLoading}
            >
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default SessionSelect;
