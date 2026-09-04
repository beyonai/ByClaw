import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Checkbox, Empty, Input, List, Modal, Pagination, Tag, message } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  batchInstallDigitalEmployeeRelResources,
  findDetailsById,
  installDigitalEmployeeRelResources,
  queryInstallTargetEmployees,
} from '@/pages/manager/service/DigitalEmployeeMgr';
import { getFileUrl } from '@/utils/file';
import type { ResourceInstallTargetContext } from '../../resourceInstallContext';
import styles from './index.module.less';

interface InstallTargetEmployee {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
  ownerType?: string;
  avatar?: string;
  installed?: boolean;
}

interface ResourceInstallDialogProps {
  open: boolean;
  resourceId: string | number;
  resourceType?: string;
  targetContext: ResourceInstallTargetContext;
  onClose: () => void;
  onSuccess?: (digitalEmployeeIds: string[]) => void;
  onInstallingChange?: (installing: boolean) => void;
}

const PAGE_SIZE = 10;

const getResponseData = (response: any) => response?.data?.data ?? response?.data ?? response ?? {};

const assertResponseSuccess = (response: any) => {
  if (response?.code !== undefined && ![0, 200].includes(Number(response.code))) {
    throw new Error(response.msg || response.message);
  }
};

const ResourceInstallDialog: React.FC<ResourceInstallDialogProps> = ({
  open,
  resourceId,
  resourceType,
  targetContext,
  onClose,
  onSuccess,
  onInstallingChange,
}) => {
  const intl = useIntl();
  const [keyword, setKeyword] = useState('');
  const [queryKeyword, setQueryKeyword] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [rows, setRows] = useState<InstallTargetEmployee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<Map<string, InstallTargetEmployee>>(new Map());
  const targetRequestIdRef = useRef(0);

  const setInstallState = useCallback(
    (value: boolean) => {
      setInstalling(value);
      onInstallingChange?.(value);
    },
    [onInstallingChange]
  );

  const loadTargets = useCallback(async () => {
    if (!open || targetContext.mode !== 'select') return;
    const requestId = ++targetRequestIdRef.current;
    setLoading(true);
    try {
      const response: any = await queryInstallTargetEmployees({
        keyword: queryKeyword || undefined,
        pageNum,
        pageSize: PAGE_SIZE,
        relResourceId: resourceId,
      });
      assertResponseSuccess(response);
      const data = getResponseData(response);
      const nextRows = (data.list || data.rows || []).map((item: any) => ({
        ...item,
        resourceId: `${item.resourceId}`,
        installed: item.installed === true || item.installed === 1 || item.installed === 'true',
      }));
      if (requestId !== targetRequestIdRef.current) return;
      setRows(nextRows);
      setTotal(Number(data.total || nextRows.length));
    } catch (error: any) {
      if (requestId !== targetRequestIdRef.current) return;
      setRows([]);
      setTotal(0);
      message.error(error?.message || intl.formatMessage({ id: 'resource.installTargetLoadFailed' }));
    } finally {
      if (requestId === targetRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [intl, open, pageNum, queryKeyword, resourceId, targetContext.mode]);

  useEffect(() => {
    if (!open) {
      targetRequestIdRef.current += 1;
      return;
    }
    setKeyword('');
    setQueryKeyword('');
    setPageNum(1);
    setSelectedEmployees(new Map());
  }, [open, resourceId]);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const selectedIds = useMemo(() => Array.from(selectedEmployees.keys()), [selectedEmployees]);

  const toggleEmployee = (employee: InstallTargetEmployee) => {
    if (employee.installed) return;
    setSelectedEmployees((previous) => {
      const next = new Map(previous);
      if (next.has(employee.resourceId)) {
        next.delete(employee.resourceId);
      } else {
        next.set(employee.resourceId, employee);
      }
      return next;
    });
  };

  const notifyInstalled = (digitalEmployeeIds: string[]) => {
    window.dispatchEvent(
      new CustomEvent('digitalEmployeeResourceInstalled', {
        detail: { resourceId, resourceType, digitalEmployeeIds },
      })
    );
    onSuccess?.(digitalEmployeeIds);
  };

  const installToEmployees = async (digitalEmployeeIds: string[]) => {
    setInstallState(true);
    try {
      if (targetContext.mode === 'fixed') {
        try {
          const employeeResponse: any = await findDetailsById({
            resourceId: targetContext.digitalEmployeeId,
          });
          assertResponseSuccess(employeeResponse);
          const employee = getResponseData(employeeResponse);
          const actualEmployeeId = employee?.resourceId ?? employee?.id;
          if (`${actualEmployeeId || ''}` !== targetContext.digitalEmployeeId) {
            throw new Error('digital employee id mismatch');
          }
        } catch {
          throw new Error(intl.formatMessage({ id: 'resource.currentEmployeeUnavailable' }));
        }
      }

      let response: any;
      if (digitalEmployeeIds.length === 1) {
        response = await installDigitalEmployeeRelResources({
          digitalEmployeeId: digitalEmployeeIds[0],
          relIds: [resourceId],
        });
      } else {
        response = await batchInstallDigitalEmployeeRelResources({
          digitalEmployeeIds,
          relIds: [resourceId],
        });
      }
      assertResponseSuccess(response);
      const data = getResponseData(response);
      const failureCount = Number(data.failureCount || 0);
      const successCount = digitalEmployeeIds.length === 1 ? 1 : Number(data.successCount || 0);
      const succeededIds =
        digitalEmployeeIds.length === 1
          ? digitalEmployeeIds
          : (data.results || []).filter((item: any) => item.success).map((item: any) => `${item.digitalEmployeeId}`);

      if (failureCount > 0 && successCount === 0) {
        const failureMessage = (data.results || []).find((item: any) => !item.success)?.message;
        throw new Error(failureMessage || intl.formatMessage({ id: 'common.operationFailed' }));
      }
      if (failureCount > 0) {
        message.warning(intl.formatMessage({ id: 'resource.installBatchResult' }, { successCount, failureCount }));
      } else {
        message.success(intl.formatMessage({ id: 'resource.installSuccess' }));
      }
      if (succeededIds.length > 0) {
        notifyInstalled(succeededIds);
      }
      onClose();
      return true;
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
      return false;
    } finally {
      setInstallState(false);
    }
  };

  const getConfirmContent = (employees: InstallTargetEmployee[]) => {
    const names = employees.map((item) => item.resourceName).filter(Boolean);
    const displayNames =
      names.length > 3 ? `${names.slice(0, 2).join('、')}等${names.length}个数字员工` : names.join('、');
    return intl.formatMessage({ id: 'resource.installToEmployeesConfirm' }, { names: displayNames });
  };

  const confirmSelectedInstall = () => {
    const employees = Array.from(selectedEmployees.values());
    if (employees.length === 0) {
      message.warning(intl.formatMessage({ id: 'resource.installTargetRequired' }));
      return;
    }
    Modal.confirm({
      title: intl.formatMessage({ id: 'resource.installConfirmTitle' }),
      content: getConfirmContent(employees),
      okText: intl.formatMessage({ id: 'common.confirm' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      onOk: () => installToEmployees(employees.map((item) => item.resourceId)),
    });
  };

  if (targetContext.mode === 'fixed') {
    return (
      <Modal
        open={open}
        title={intl.formatMessage({ id: 'resource.installConfirmTitle' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={installing}
        maskClosable={!installing}
        closable={!installing}
        onCancel={onClose}
        onOk={() => installToEmployees([targetContext.digitalEmployeeId])}
      >
        {intl.formatMessage({ id: 'resource.installToEmployeesConfirm' }, { names: targetContext.digitalEmployeeName })}
      </Modal>
    );
  }

  if (targetContext.mode === 'unavailable') {
    return (
      <Modal
        open={open}
        title={intl.formatMessage({ id: 'resource.installConfirmTitle' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelButtonProps={{ style: { display: 'none' } }}
        onCancel={onClose}
        onOk={onClose}
      >
        {intl.formatMessage({ id: 'resource.currentEmployeeUnavailable' })}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      width={680}
      title={intl.formatMessage({ id: 'resource.selectInstallTarget' })}
      okText={intl.formatMessage({ id: 'resource.installSelectedEmployees' }, { count: selectedIds.length })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      okButtonProps={{ disabled: selectedIds.length === 0 }}
      confirmLoading={installing}
      maskClosable={!installing}
      closable={!installing}
      onCancel={onClose}
      onOk={confirmSelectedInstall}
    >
      <Input.Search
        allowClear
        value={keyword}
        placeholder={intl.formatMessage({ id: 'resource.installTargetSearchPlaceholder' })}
        onChange={(event) => {
          const value = event.target.value;
          setKeyword(value);
          if (!value) {
            setQueryKeyword('');
            setPageNum(1);
          }
        }}
        onSearch={(value) => {
          setQueryKeyword(value.trim());
          setPageNum(1);
        }}
      />
      <List
        className={styles.employeeList}
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(employee) => {
          const selected = selectedEmployees.has(employee.resourceId);
          const avatarUrl = employee.avatar ? getFileUrl(employee.avatar) : undefined;
          return (
            <List.Item
              className={`${styles.employeeItem} ${selected ? styles.employeeItemSelected : ''} ${
                employee.installed ? styles.employeeItemDisabled : ''
              }`}
              onClick={() => toggleEmployee(employee)}
            >
              <Checkbox checked={selected} disabled={employee.installed} />
              <Avatar src={avatarUrl} icon={<UserOutlined />} />
              <div className={styles.employeeInfo}>
                <div className={styles.employeeTitle}>
                  <span title={employee.resourceName}>{employee.resourceName}</span>
                  <Tag>
                    {employee.ownerType === 'enterprise'
                      ? intl.formatMessage({ id: 'resource.enterpriseEmployee' })
                      : intl.formatMessage({ id: 'resource.personalEmployee' })}
                  </Tag>
                  {employee.installed && <Tag color="default">{intl.formatMessage({ id: 'resource.installed' })}</Tag>}
                </div>
                <div className={styles.employeeDesc} title={employee.resourceDesc}>
                  {employee.resourceDesc || intl.formatMessage({ id: 'common.none' })}
                </div>
              </div>
            </List.Item>
          );
        }}
      />
      {total > PAGE_SIZE && (
        <Pagination
          className={styles.pagination}
          current={pageNum}
          pageSize={PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          onChange={setPageNum}
        />
      )}
    </Modal>
  );
};

export default ResourceInstallDialog;
