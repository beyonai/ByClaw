import AntdIcon from '@/components/AntdIcon';
import ShareModal from '@/pages/knowledgeCenter/components/shareModal';
import VisibleRange from '@/pages/knowledgeCenter/components/VisibleRange';
import { deleteKnowledge } from '@/pages/manager/service/resources';
import { Tooltip, message, Modal, Spin } from 'antd';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import styles from './index.module.less';
// @ts-ignore
import { useIntl, useNavigate } from '@umijs/max';
import { isEmpty } from 'lodash';

const hiddenForNow = true;

const BaseInfo = ({
  data,
  resourceId,
  allowKnowledgeBaseDelete,
  backPath = '/knowledgeCenter',
}: {
  data: any;
  resourceId: string;
  allowKnowledgeBaseDelete?: boolean;
  backPath?: string;
}) => {
  const [showVisibleRange, setShowVisibleRange] = useState(false);
  const [showShareModal, setShareModal] = useState(false);

  const intl = useIntl();
  const navigate = useNavigate();
  const disabledTip = intl.formatMessage({ id: 'resource.thirdPartyKnowledgeBaseMode' });

  const renderIcon = useMemo(() => {
    try {
      const { icon, color } = JSON.parse(data?.resourceLogoUrl || '{}');
      return (
        <div
          className={styles.fileDefaultIcon}
          style={{
            backgroundColor: (color || 'rgba(22, 93, 255, 1)')?.replace('1)', '0.1)'),
          }}
        >
          <AntdIcon
            type={`icon-${icon || 'a-Book-oneshuji12'}`}
            style={{ fontSize: 32, color: color || 'rgba(22, 93, 255, 1)' }}
          />
        </div>
      );
    } catch {
      return <img className={styles.fileDefaultIcon} src={data?.logoUrl} alt="logoUrl" />;
    }
  }, [data]);

  const onDeleteFolder = () => {
    if (!allowKnowledgeBaseDelete) {
      return;
    }
    Modal.confirm({
      title: intl.formatMessage({ id: 'common.deleteTips' }),
      content: intl.formatMessage({ id: 'common.deleteConfirm2' }, { content: data?.resourceName }),
      onOk: () =>
        deleteKnowledge({ resourceId: resourceId }).then(() => {
          message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
          navigate(backPath, { replace: true });
        }),
    });
  };

  const baseInfo = (
    <div className={styles.baseInfoContainer}>
      {renderIcon}
      <div className={styles.baseInfoContent}>
        <div className={styles.baseInfoTitle}>{data?.resourceName}</div>
        <div className={classNames(styles.baseInfoDesc, 'textEllipsis3')}>{data?.resourceDesc}</div>
      </div>
      <div className={styles.baseInfoAction}>
        {!hiddenForNow && (
          <>
            <div
              className="disabled"
              // onClick={() => {
              //   setShowVisibleRange(true);
              // }}
            >
              <AntdIcon type="icon-a-Locksuoding" style={{ fontSize: '16px' }} />
            </div>
            <div
              className={styles.baseInfoActionItem}
              onClick={() => {
                setShareModal(true);
              }}
            >
              <AntdIcon type="icon-a-Share-twofenxiang2" style={{ fontSize: '16px' }} />
            </div>
          </>
        )}

        <Tooltip title={!allowKnowledgeBaseDelete ? disabledTip : undefined}>
          <div
            className={classNames(styles.baseInfoActionItem, {
              disabled: !allowKnowledgeBaseDelete,
            })}
            onClick={onDeleteFolder}
          >
            <AntdIcon type="icon-a-Deleteshanchu" style={{ fontSize: '16px' }} />
          </div>
        </Tooltip>
      </div>
      {showShareModal && (
        <ShareModal
          onOk={() => {
            setShareModal(false);
            // reload?.({});
          }}
          onCancel={() => setShareModal(false)}
          info={{
            ...data,
            objId: data?.id,
          }}
        />
      )}
      {showVisibleRange && (
        <VisibleRange
          onCancel={() => setShowVisibleRange(false)}
          onOk={() => setShowVisibleRange(false)}
          info={{
            ...data,
            objId: data?.id,
          }}
        />
      )}
    </div>
  );

  return <Spin spinning={isEmpty(baseInfo)}>{baseInfo}</Spin>;
};

export default BaseInfo;
