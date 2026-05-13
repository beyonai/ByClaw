import { message } from 'antd';
import React from 'react';
import { isEmpty, pick, head } from 'lodash';
import { useSelector, useIntl } from '@umijs/max';

import PersonalSelect from '@/components/PersonalSelect';
import { searchTypeMap } from '@/components/PersonnelModel/const';
import { dataItemTypeMap } from '@/components/PersonnelModel';
import { insertNotification } from '@/service/notice';

import type { NotificationInstance } from 'antd/es/notification/interface.d.ts';

type IProps = {
  sessionSelectOpen: boolean;
  notificationMessage: NotificationInstance;

  getExtraInfo: () => {
    shareSourceType: 'chat' | 'collect';
    shareData: Record<string, any>;
  };
  onClose: () => void;
};

function ShareSelect(props: IProps) {
  const { sessionSelectOpen, notificationMessage, getExtraInfo, onClose } = props;
  const intl = useIntl();

  const { userInfo } = useSelector((state: any) => state.user);

  return (
    <PersonalSelect
      destroyOnHidden
      visible={sessionSelectOpen}
      onCancel={onClose}
      onOk={(vals: any) => {
        if (isEmpty(vals)) {
          message.error(intl.formatMessage({ id: 'multiChoices.shareSelect.selectPerson' }));
          return;
        }

        notificationMessage.info({
          message: intl.formatMessage({ id: 'multiChoices.shareSelect.sharing' }),
          icon: null,
          placement: 'bottomRight',
          duration: 0,
        });

        const content = intl.formatMessage(
          { id: 'notice.messageComp.share.shareMessage' },
          {
            userName: userInfo?.userName || intl.formatMessage({ id: 'common.user' }),
            text: intl.formatMessage({ id: 'notice.messageComp.share.oneMessage' }),
          }
        );

        let extraInfo = '{}';
        try {
          extraInfo = JSON.stringify({
            ...getExtraInfo(),
            senderInfo: {
              ...pick(userInfo, ['userName', 'userId', 'userCode']),
            },
          });
        } catch (e) {
          console.error(e);
        }

        insertNotification({
          title: intl.formatMessage({ id: 'common.shareTitle' }),
          content,
          targetId: `${head(vals)?.userId}`,
          contentType: '5002',
          extraInfo,
        })
          .then(() => {
            notificationMessage.destroy();
            notificationMessage.success({
              message: intl.formatMessage({ id: 'common.shareSuccess' }),
              icon: null,
              placement: 'bottomRight',
            });
          })
          .catch(() => {
            notificationMessage.destroy();
            notificationMessage.error({
              message: intl.formatMessage({ id: 'common.shareFailed' }),
              icon: null,
              placement: 'bottomRight',
            });
          });

        onClose();
      }}
      confirmLoading={false}
      selectedValue={[]}
      disabledList={[dataItemTypeMap.org, dataItemTypeMap.agent]}
      searchTypeMapList={[searchTypeMap.user]}
      disabledIds={[`${userInfo.userId}_${dataItemTypeMap.user.toLocaleLowerCase()}`]}
      maxSelectCount={1}
    />
  );
}
export default ShareSelect;
