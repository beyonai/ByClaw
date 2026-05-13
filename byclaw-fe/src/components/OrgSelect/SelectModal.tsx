import React from 'react';
import classNames from 'classnames';
import { Modal, Button, Checkbox } from 'antd';
import { compact, pullAllBy } from 'lodash';
import { CloseOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import { dataItemTypeMap } from './const';

import CheckboxRender from './components/CheckboxRender';
import RightItemRender from '@/components/OrgSelect/components/RightItemRender';

import { IOrg } from '@/typescript/user';
import Empty from '@/components/Empty';

import styles from './index.module.less';

export type IOrgCache = IOrg & {
  id: string;
  name: string;
  type: keyof typeof dataItemTypeMap;
  disabled?: boolean;
};

type IProps = {
  open: boolean;
  onClose: () => void;
  onOK?: (val: IOrgCache[]) => void;

  dataList: IOrgCache[];
  selectList: IOrgCache[];
  setSelectList: React.Dispatch<React.SetStateAction<IOrgCache[]>>;
};

export default function SelectModal(props: IProps) {
  const { open, onClose, onOK } = props;
  const { dataList, selectList, setSelectList } = props;
  const intl = useIntl();

  return (
    <Modal
      centered
      destroyOnHidden
      open={open}
      rootClassName={styles.modal}
      onCancel={onClose}
      footer={null}
      closeIcon={null}
    >
      <div className="full-width full-height ub gap4">
        <div className={classNames(styles.leftWraper, 'ub ub-ver')}>
          <p className={styles.title}>{intl.formatMessage({ id: 'orgSelect.filterTitle' })}</p>
          <div className="ub-f1 overflow-auto">
            {dataList.length > 0 ? (
              <Checkbox.Group
                className={classNames(styles.checkboxGroup, 'ub ub-ver gap8 ub-f1')}
                value={selectList.map((item) => item.id)}
                onChange={(checkedValue: string[]) => {
                  setSelectList(() => {
                    return compact(
                      checkedValue.map((selectId) => {
                        return dataList.find((item) => item.id === selectId);
                      })
                    );
                  });
                }}
              >
                {dataList.map((item) => (
                  <React.Fragment key={item.id}>
                    <CheckboxRender item={item} />
                  </React.Fragment>
                ))}
              </Checkbox.Group>
            ) : (
              <div className="ub ub-ac ub-pc full-height">
                <Empty description="暂无数据" />
              </div>
            )}
          </div>
        </div>
        <div className={classNames(styles.rightWraper, 'ub-f1 ub ub-ver gap8')}>
          <div className="ub ub-f1 ub-wrap gap8 pointer hideThumb" style={{ alignContent: 'flex-start' }}>
            {selectList.map((item) => {
              return (
                <div key={item?.id} className={classNames(styles.listItem, 'ub ub-ac gap6')}>
                  <RightItemRender item={item} />
                  <CloseOutlined
                    className={classNames(styles.closeBtn, 'pointer')}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();

                      const myPersonalSelectValue = [...selectList];
                      pullAllBy(myPersonalSelectValue, [item], 'id');
                      setSelectList(myPersonalSelectValue);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="ub ub-ac ub-pe gap12">
            <Button onClick={onClose}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button
              type="primary"
              onClick={() => {
                onOK?.(selectList);
                onClose();
              }}
            >
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
