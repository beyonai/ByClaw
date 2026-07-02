import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { batchHandleAuth, listAuthDetail } from '@/pages/manager/service/DigitalResourceMgr';
import type { WorkspaceSkillItem } from './utils';

const SHARE_GRANT_TYPE = 'FORCE_USE';

const getGrantItem = (item: any) => ({
  ...item,
  id: `${String(item.grantToObjType).toLowerCase()}_${item.grantToObjId}`,
  name: item.grantToObjName,
  type: item.grantToObjType,
});

const transformGrantItem = (item: any) => {
  const [, idFromKey] = String(item.id || '').split('_');
  return {
    grantToObjId: idFromKey || item.grantToObjId,
    grantToObjType: item.type || item.grantToObjType,
  };
};

interface AuthDetailResponse {
  code?: number;
  msg?: string;
  data?: { redList?: any[]; blackList?: any[] };
}

interface Props {

  /** 已资源化后的技能记录，需带 resourceId + resourceBizType。 */
  record: WorkspaceSkillItem;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * 工作空间技能资源化后的“使用授权(FORCE_USE)”弹窗。
 * 打开时拉取已有授权明细，确认时写回。左右两侧共用。
 */
const WorkspaceSkillShareAuthModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const intl = useIntl();
  const [ready, setReady] = useState(false);
  const [authList, setAuthList] = useState<any[]>([]);
  const [blackList, setBlackList] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!record?.resourceId || !record?.resourceBizType) {
      onClose();
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const detail = (await listAuthDetail({
          grantType: SHARE_GRANT_TYPE,
          grantObjType: record.resourceBizType,
          grantObjId: record.resourceId,
        })) as unknown as AuthDetailResponse;
        if (cancelled) return;
        if (detail && detail.code === 0) {
          setAuthList(detail.data?.redList?.map(getGrantItem) || []);
          setBlackList(detail.data?.blackList?.map(getGrantItem) || []);
          setReady(true);
          return;
        }
        message.error(detail?.msg || intl.formatMessage({ id: 'common.operationFailed' }));
        onClose();
      } catch (error: any) {
        if (cancelled) return;
        message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.resourceId, record?.resourceBizType]);

  const handleConfirm = async (nextAuthList: any[]) => {
    if (!record?.resourceId || !record?.resourceBizType) return;
    const redList = nextAuthList.map((item) => ({ ...transformGrantItem(item), grantType: SHARE_GRANT_TYPE }));
    const blackListPayload = blackList.map((item) => ({ ...transformGrantItem(item), grantType: SHARE_GRANT_TYPE }));
    try {
      const res = (await batchHandleAuth(
        {
          grantObjId: record.resourceId,
          grantObjType: record.resourceBizType,
          redList,
          blackList: blackListPayload,
          resourceId: record.resourceId,
        },
        '/byaiService/auth/privilegeGrant/setResourceUsers'
      )) as unknown as { code?: number; msg?: string };
      if (res && res.code === 0) {
        message.success(intl.formatMessage({ id: 'common.shareSuccess' }));
        onSuccess?.();
        onClose();
        return;
      }
      message.error(res?.msg || intl.formatMessage({ id: 'common.shareFailed' }));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'common.shareFailed' }));
    }
  };

  if (!ready) {
    return null;
  }

  return (
    <AddAuthModal
      title={intl.formatMessage({ id: 'auth.addAuthObject' })}
      value={authList}
      showPost={false}
      onCancel={onClose}
      onOk={handleConfirm}
    />
  );
};

export default WorkspaceSkillShareAuthModal;
