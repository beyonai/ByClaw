// @ts-nocheck
import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Form, Input, message, Select, TreeSelect } from 'antd';
import { isNil } from 'lodash';
import { useDispatch, connect, useIntl } from '@umijs/max';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import { arrayToTree } from '@/pages/manager/utils/managerUtils';
import { showPublishConfirm } from '@/pages/manager/utils/publishConfirm';
import styles from './index.module.less';

const PublishModal = (props) => {
  const {
    open,
    _type, // eslint-disable-line @typescript-eslint/no-unused-vars
    data,
    onCancel,
    reload,
    loading = false,
    orgLoading = false,
    manUserLoading = false,
    catalogLoading = false,
  } = props;

  const intl = useIntl();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { resourceId, _resourceType, objId } = data || {};

  const [orgList, setOrgList] = useState([]);
  const [userIdOpts, setUserIdOpts] = useState([]);
  const [catalogList, setCatalogList] = useState([]);

  const dispatch = useDispatch();

  // 使用 arrayToTree 构建组织树结构
  const treeData = useMemo(() => {
    return arrayToTree(orgList, { sortKey: 'orgIndex' });
  }, [orgList]);

  const [form] = Form.useForm();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _orgId = Form.useWatch('orgId', form);

  const onChangeOrgId = (v) => {
    if (v) {
      form.setFieldValue('manUserId', undefined);
      dispatch({
        type: 'orgMgr/getPublishByOrgId',
        payload: { orgId: v },
        success: (res) => {
          setUserIdOpts(res.data || []);
        },
      });
    }
  };

  useEffect(() => {
    dispatch({
      type: 'orgMgr/getOrgTree',
      payload: {
        containsParent: true,
      },
      success: (res) => {
        setOrgList(res.data || []);
      },
    });
    dispatch({
      type: 'employeeMgr/getCatalogOnResource',
      payload: {
        catalogType: 6,
      },
      success: (res) => {
        setCatalogList(res || []);
      },
    });
  }, []);

  useEffect(() => {
    if (data?.manOrgId) {
      dispatch({
        type: 'orgMgr/getPublishByOrgId',
        payload: { orgId: data.manOrgId },
        success: (res) => {
          const userOpts = (res.data || []).map((x) => ({
            ...x,
            userId: String(x.userId),
          }));

          setUserIdOpts(userOpts);
        },
      });
    }

    if (data) {
      form.setFieldsValue({
        ...data,
        orgId: !isNil(data.manOrgId) ? data.manOrgId : undefined,
        catalogId: !isNil(data.catalogId) ? data.catalogId : undefined,
        manUserId: !isNil(data.manUserId) ? data.manUserId.split(',') : undefined,
      });
    }
  }, [data]);

  // 执行发布操作
  const executePublish = useCallback(
    (formValues) => {
      const { remark, orgId: selectedOrgId, manUserId, catalogId } = formValues;

      dispatch({
        type: 'employeeMgr/publishApp',
        payload: {
          objId,
          remark,
          resources: [
            {
              ...data,
            },
          ],
          publishChannels: [
            {
              catalogId, // 发布的目录
              manOrgId: selectedOrgId,
              manUserId: manUserId?.join(','),
              enable: true, // 是否启用
            },
          ],
        },
        success: () => {
          message.success(intl.formatMessage({ id: 'resourceAction.publishSuccess' }));
          onCancel();
          reload();
        },
      });
    },
    [dispatch, objId, data, onCancel, reload, intl]
  );

  const handleOk = useCallback(async () => {
    const res = await form.validateFields();
    if (!res) {
      return;
    }

    // 先调用校验接口
    const checkResourceId = resourceId || data?.resourceId || '';
    if (!checkResourceId) {
      message.error('缺少 resourceId 参数');
      return;
    }

    // 获取表单中的组织ID
    const { orgId: selectedOrgId } = res;
    if (!selectedOrgId) {
      message.error('请选择组织');
      return;
    }

    // 显示校验 loading
    dispatch({
      type: 'employeeMgr/checkDigitalEmployeePublish',
      payload: {
        resourceId: Number(checkResourceId),
        type: 'publish',
        manOrgIdList: [String(selectedOrgId)],
      },
      success: (response) => {
        // 当 code=0 并且 data=null 时，直接执行下一步操作
        if (!response.data || response.data === null) {
          executePublish(res);
          return;
        }

        // 当 code=0 并且 data 里面的 compliance 都为 true 时，直接执行下一步操作
        const dataList = Array.isArray(response.data) ? response.data : [];
        const allCompliant = dataList.every((item) => item.compliance === true);
        if (allCompliant) {
          executePublish(res);
          return;
        }

        // 当 code=0 并且 data 里面的 compliance 有为 false 时，弹出 confirm
        const unpassedItems = dataList.filter((item) => item.compliance === false);
        if (unpassedItems.length > 0) {
          showPublishConfirm(unpassedItems, '发布').then((confirmed) => {
            if (confirmed) {
              // 用户点击"继续保存"
              executePublish(res);
            }
            // 用户点击"取消"，不执行任何操作
          });
        } else {
          // 如果没有不通过的项，直接执行发布
          executePublish(res);
        }
      },
      fail: () => {
        // 校验接口调用失败，不执行发布操作
      },
    });
  }, [dispatch, form, resourceId, data, executePublish]);

  return (
    <ModalDrawer
      className={styles.documentLibraryInfoModal}
      wrapClassName={styles.modalWrap}
      type="modal"
      title={intl.formatMessage({ id: 'common.publish' })}
      open={open}
      onCancel={onCancel}
      paddingSize="padding-none"
      width={560}
      showFoot={false}
      onOk={handleOk}
      confirmLoading={loading}
      style={{
        top: 60,
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={
            <>
              <span className={styles.labelLeftStyle} />
              <span>{intl.formatMessage({ id: 'publishModal.catalog' })}</span>
              <AntdIcon
                className={styles.labelRightStyle}
                type="icon-a-Helpbangzhu1"
                title={intl.formatMessage({ id: 'publishModal.catalogTip' })}
                toolTipProps={{
                  placement: 'right',
                }}
              />
            </>
          }
          name="catalogId"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'publishModal.catalogRequired',
              }),
            },
          ]}
        >
          <TreeSelect
            treeData={catalogList}
            placeholder={intl.formatMessage({
              id: 'publishModal.catalogRequired',
            })}
            treeDataSimpleMode={{
              id: 'catalogId',
              pId: 'pcatalogId',
              rootPId: -1,
            }}
            fieldNames={{
              label: 'catalogName',
              value: 'catalogId',
            }}
            showSearch
            treeNodeFilterProp="catalogName"
            loading={catalogLoading}
          />
        </Form.Item>
        <Form.Item
          label={
            <>
              <span className={styles.labelLeftStyle} />
              <span>{intl.formatMessage({ id: 'publishModal.organization' })}</span>
            </>
          }
          name="orgId"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'publishModal.organizationRequired',
              }),
            },
          ]}
        >
          <TreeSelect
            treeData={treeData}
            placeholder={intl.formatMessage({
              id: 'publishModal.organizationRequired',
            })}
            treeDefaultExpandAll
            fieldNames={{
              label: 'orgName',
              value: 'orgId',
              children: 'children',
            }}
            showSearch
            treeNodeFilterProp="orgName"
            loading={orgLoading}
            onChange={onChangeOrgId}
          />
        </Form.Item>
        <Form.Item
          label={
            <>
              <span className={styles.labelLeftStyle} />
              <span>{intl.formatMessage({ id: 'publishModal.manager' })}</span>
              <AntdIcon
                className={styles.labelRightStyle}
                type="icon-a-Helpbangzhu1"
                title={intl.formatMessage({ id: 'publishModal.managerTip' })}
                toolTipProps={{
                  placement: 'right',
                }}
              />
            </>
          }
          name="manUserId"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'publishModal.managerRequired',
              }),
            },
          ]}
        >
          <Select
            placeholder={intl.formatMessage({
              id: 'publishModal.managerRequired',
            })}
            options={userIdOpts}
            fieldNames={{
              label: 'userName',
              value: 'userId',
            }}
            showSearch
            optionFilterProp="userName"
            loading={manUserLoading}
            mode="multiple"
          />
        </Form.Item>
        <Form.Item
          label={
            <>
              <span className={styles.labelLeftStyle} />
              <span>{intl.formatMessage({ id: 'publishModal.remark' })}</span>
              <AntdIcon
                className={styles.labelRightStyle}
                type="icon-a-Helpbangzhu1"
                title={intl.formatMessage({ id: 'publishModal.remarkTip' })}
                toolTipProps={{
                  placement: 'right',
                }}
              />
            </>
          }
          name="remark"
        >
          <Input.TextArea
            rows={6}
            placeholder={intl.formatMessage({
              id: 'publishModal.remarkPlaceholder',
            })}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </ModalDrawer>
  );
};

export default connect(({ loading }) => ({
  loading: loading.effects['employeeMgr/publishApp'] || loading.effects['employeeMgr/checkDigitalEmployeePublish'],
  orgLoading: loading.effects['orgMgr/getOrgTree'],
  manUserLoading: loading.effects['orgMgr/getPublishByOrgId'],
  catalogLoading: loading.effects['employeeMgr/getCatalogOnResource'],
}))(PublishModal);
