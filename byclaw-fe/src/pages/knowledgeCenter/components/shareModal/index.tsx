// tslint:disable:ordered-imports
import React, { useEffect, useState } from 'react';
import ShareTagItem from '@/components/shareTagItem';
import { useRequest } from '@/hooks/useRequest';
import { listAuthDetail, share } from '@/service/knowledgeCenter';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Checkbox, Input, message, Modal, Select } from 'antd';
import classNames from 'classnames';
import styles from './index.module.less';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { ResourceTypeMap } from '@/constants/resource';

const ShareModal = ({ onCancel, onOk, info }: { onCancel: () => void; onOk: () => void; info: any }) => {
  const intl = useIntl();

  const [note, setNote] = useState('');
  const [isSendNotice, setIsSendNotice] = useState(true);
  const [, setMemberSelect] = useState(false);
  const [selectMember, setSelectMember] = useState<any[]>([]);
  console.log(info);
  useEffect(() => {
    listAuthDetail({
      grantType: 'SHARE_USE', // 固定为SHARE_USE，分享授权
      grantObjType: ResourceTypeMap.knowledgeBase, // 文档库
      grantObjId: info?.resourceId, // 授权对象id - resourceId
    })
      .then((res) => {
        const { redList = [], note, isSendNotice } = res || {};
        setSelectMember(
          redList.map((it: any) => ({
            label: it?.grantToObjName,
            value: `org_${it?.grantToObjId ?? ''}`,
            type: it?.grantToObjType,
            [it?.grantToObjIdorgId === 'ORG' ? 'orgId' : 'userId']: it?.grantToObjId,
            [it?.grantToObjIdorgId === 'ORG' ? 'orgName' : 'userName']: it?.grantToObjName,
          }))
        );
        setNote(note || '');
        setIsSendNotice(isSendNotice || true);
      })
      .catch((err) => {
        console.error(err);
        message.error(err);
      });
  }, []);

  const { mutate, isLoading } = useRequest({
    mutationFn: () =>
      share({
        objId: info?.resourceId,
        priviledge: {
          org: selectMember
            .filter((it) => it.type === 'ORG')
            .map((it) => it.orgId)
            ?.toString(),
          user: selectMember
            .filter((it) => it.type === 'USER')
            .map((it) => it.userId)
            ?.toString(),
        },
        privType: 'R', // 先固定
        isSendNotice, // 是否发送通知
        note, // 备注
      }),
    onSuccess: () => {
      onOk();
    },
  });

  return (
    <>
      <Modal
        title={intl.formatMessage({ id: 'common.share' })}
        onCancel={onCancel}
        onOk={() => mutate({})}
        open
        okText={intl.formatMessage({ id: 'shareModal.sendNow' })}
        className={styles.shareWrap}
        confirmLoading={isLoading}
      >
        <div>
          <div className={styles.selectListContainer}>
            <div className={classNames(styles.selectList, 'overflow-auto hideThumb')}>
              {selectMember.map((item) => (
                <ShareTagItem
                  key={item.value}
                  item={item}
                  onClose={() => {
                    setSelectMember(selectMember.filter((ele) => ele.value !== item.value));
                  }}
                />
              ))}
            </div>
            <span
              className={`iconfont icon-a-People-plustianjiarenqun ${styles.addIcon}`}
              onClick={(e) => {
                e.stopPropagation();
                setMemberSelect(true);
              }}
            />
          </div>
          <div className={styles.tipsWrap}>
            <span className={styles.tips}>
              <ExclamationCircleOutlined /> {intl.formatMessage({ id: 'shareModal.permissionType' })}:
            </span>
            <Select
              defaultValue={intl.formatMessage({
                id: 'shareModal.viewDownload',
              })}
              size="small"
              variant="borderless"
            />
          </div>
          <p>
            <Checkbox checked={isSendNotice} onChange={(e) => setIsSendNotice(e.target.checked)}>
              {intl.formatMessage({ id: 'shareModal.sendNotification' })}
            </Checkbox>
          </p>
          <Input.TextArea
            placeholder={intl.formatMessage({ id: 'shareModal.addRemark' })}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
};

export default ShareModal;
