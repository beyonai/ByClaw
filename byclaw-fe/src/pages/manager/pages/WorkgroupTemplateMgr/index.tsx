import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  TreeSelect,
  message,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import EmployeeGroupMembers from '@/pages/manager/pages/digitalEmployeeMgr/EmployeeDetail/EmployeeGroupMembers';
import { getAllDigitalEmployeesV2 } from '@/service/digitalEmployees';
import { publicationErrorMessage } from '@/utils/publicationError';
import {
  createManagedWorkgroupTemplate,
  deleteManagedWorkgroupTemplate,
  getWorkgroupTemplateCapability,
  listManagedWorkgroupTemplates,
  listWorkgroupTemplateCatalogs,
  updateManagedWorkgroupTemplate,
  type WorkgroupTemplate,
  type WorkgroupTemplateEmployee,
} from '../../service/WorkgroupTemplate';
import styles from './index.module.less';

type SelectedResource = WorkgroupTemplateEmployee & { resourceId: string; agentType?: string };

const loadTemplateCandidates = async (params: Record<string, unknown>, cancelToken?: AbortController) => {
  const result = await getAllDigitalEmployeesV2(
    {
      ...params,
      includeEmployeeGroup: true,
      employeeGroupFirst: true,
    },
    cancelToken
  );
  return result?.data || result;
};

const toCatalogTreeData = (catalogs: any[]) =>
  catalogs.map((catalog) => ({
    id: String(catalog.catalogId),
    pId:
      catalog.pCatalogId === null || catalog.pCatalogId === undefined || Number(catalog.pCatalogId) < 0
        ? undefined
        : String(catalog.pCatalogId),
    value: String(catalog.catalogId),
    title: catalog.catalogName,
  }));

export default function WorkgroupTemplateMgr() {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const [allowed, setAllowed] = useState<boolean>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WorkgroupTemplate[]>([]);
  const [catalogs, setCatalogs] = useState<any[]>([]);
  const [resources, setResources] = useState<SelectedResource[]>([]);
  const [editing, setEditing] = useState<WorkgroupTemplate>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const savingRef = useRef(false);
  const [form] = Form.useForm();

  const reload = async () => {
    setLoading(true);
    try {
      setItems((await listManagedWorkgroupTemplates()) || []);
    } catch (error) {
      // 列表刷新失败单独提示，避免已保存成功后又显示“模板保存失败”。
      message.error(publicationErrorMessage(error, intl.formatMessage({ id: 'workgroupTemplate.loadFailed' })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getWorkgroupTemplateCapability()
      .then((value) => {
        setAllowed(value === true);
        if (value) {
          void reload();
          listWorkgroupTemplateCatalogs().then((list) => setCatalogs(list || []));
        }
      })
      .catch(() => setAllowed(false));
  }, []);

  if (userInfo?.userCode?.toLowerCase() === 'adminvip' && allowed === undefined) return <Spin fullscreen />;
  if (userInfo?.userCode?.toLowerCase() !== 'adminvip' || !allowed) {
    return <Alert type="warning" message={intl.formatMessage({ id: 'workgroupTemplate.adminOnly' })} />;
  }

  const edit = (item?: WorkgroupTemplate) => {
    setEditing(item);
    setResources(
      item?.resources.map((resource) => ({
        resourceId: resource.resourceId,
        id: resource.resourceId,
        name: resource.resourceName,
      })) || []
    );
    form.setFieldsValue(item ? { ...item.template, expectedVersion: item.template.version } : { sortOrder: 0 });
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(undefined);
    setResources([]);
    form.resetFields();
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{intl.formatMessage({ id: 'workgroupTemplate.title' })}</h1>
          <p>{intl.formatMessage({ id: 'workgroupTemplate.description' })}</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          {intl.formatMessage({ id: 'workgroupTemplate.create' })}
        </Button>
      </div>

      <Table
        loading={loading}
        rowKey={(item) => item.template.templateId}
        dataSource={items}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        columns={[
          {
            title: intl.formatMessage({ id: 'workgroupTemplate.template' }),
            render: (_, item) => (
              <div className={styles.templateCell}>
                <strong>{item.template.templateName}</strong>
                <span>{item.template.summary}</span>
              </div>
            ),
          },
          { title: intl.formatMessage({ id: 'workgroupTemplate.catalog' }), dataIndex: 'catalogName', width: 180 },
          {
            title: intl.formatMessage({ id: 'workgroupTemplate.team' }),
            width: 260,
            render: (_, item) =>
              item.available === false ? (
                <span className={styles.unavailable}>
                  {item.unavailableReason || intl.formatMessage({ id: 'workgroupTemplate.unavailable' })}
                </span>
              ) : (
                <Space size={[4, 4]} wrap>
                  {item.resources.map((resource) => (
                    <Tag key={resource.resourceId}>{resource.resourceName}</Tag>
                  ))}
                </Space>
              ),
          },
          {
            title: intl.formatMessage({ id: 'common.operation' }),
            width: 150,
            render: (_, item) => (
              <Space size={0}>
                <Button type="link" onClick={() => edit(item)}>
                  {intl.formatMessage({ id: 'common.edit' })}
                </Button>
                <Popconfirm
                  title={intl.formatMessage({ id: 'workgroupTemplate.deleteConfirm' })}
                  description={intl.formatMessage({ id: 'workgroupTemplate.deleteDescription' })}
                  okText={intl.formatMessage({ id: 'common.delete' })}
                  cancelText={intl.formatMessage({ id: 'common.cancel' })}
                  okButtonProps={{ danger: true, loading: deletingId === item.template.templateId }}
                  onConfirm={async () => {
                    setDeletingId(item.template.templateId);
                    try {
                      await deleteManagedWorkgroupTemplate(item.template.templateId, item.template.version);
                      message.success(intl.formatMessage({ id: 'workgroupTemplate.deleteSuccess' }));
                      await reload();
                    } catch (error) {
                      message.error(
                        publicationErrorMessage(error, intl.formatMessage({ id: 'workgroupTemplate.deleteFailed' }))
                      );
                    } finally {
                      setDeletingId(undefined);
                    }
                  }}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    {intl.formatMessage({ id: 'common.delete' })}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        className={styles.editorModal}
        title={
          editing
            ? intl.formatMessage({ id: 'workgroupTemplate.editTitle' })
            : intl.formatMessage({ id: 'workgroupTemplate.createTitle' })
        }
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={860}
        okText={intl.formatMessage({ id: 'workgroupTemplate.save' })}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          className={styles.form}
          onFinish={async (values) => {
            if (savingRef.current) return;
            if (!resources.length) {
              message.warning(intl.formatMessage({ id: 'workgroupTemplate.resourceRequired' }));
              return;
            }
            const payload = { ...values, resourceIds: resources.map((resource) => resource.resourceId) };
            savingRef.current = true;
            setSaving(true);
            try {
              if (editing) await updateManagedWorkgroupTemplate(editing.template.templateId, payload);
              else await createManagedWorkgroupTemplate(payload);
              message.success(intl.formatMessage({ id: 'workgroupTemplate.saveSuccess' }));
              close();
              await reload();
            } catch (error) {
              // 请求层会将接口 msg 作为字符串拒绝；保留具体原因并保留表单供修正后重试。
              message.error(publicationErrorMessage(error, intl.formatMessage({ id: 'workgroupTemplate.saveFailed' })));
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
        >
          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'workgroupTemplate.basicInfo' })}</div>
          <div className={styles.twoColumns}>
            <Form.Item
              name="templateName"
              label={intl.formatMessage({ id: 'workgroupTemplate.name' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'workgroupTemplate.nameRequired' }) }]}
            >
              <Input maxLength={100} placeholder={intl.formatMessage({ id: 'workgroupTemplate.namePlaceholder' })} />
            </Form.Item>
            <Form.Item
              name="catalogId"
              label={intl.formatMessage({ id: 'workgroupTemplate.catalog' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'workgroupTemplate.catalogRequired' }) }]}
            >
              <TreeSelect
                treeDataSimpleMode
                treeData={toCatalogTreeData(catalogs)}
                showSearch
                treeNodeFilterProp="title"
                placeholder={intl.formatMessage({ id: 'workgroupTemplate.catalogPlaceholder' })}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="summary"
            label={intl.formatMessage({ id: 'workgroupTemplate.summary' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'workgroupTemplate.summaryRequired' }) }]}
          >
            <Input.TextArea
              maxLength={500}
              showCount
              rows={3}
              placeholder={intl.formatMessage({ id: 'workgroupTemplate.summaryPlaceholder' })}
            />
          </Form.Item>

          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'workgroupTemplate.defaults' })}</div>
          <Form.Item
            name="defaultGroupName"
            label={intl.formatMessage({ id: 'workgroupTemplate.groupName' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'workgroupTemplate.groupNameRequired' }) }]}
          >
            <Input maxLength={100} placeholder={intl.formatMessage({ id: 'workgroupTemplate.groupNamePlaceholder' })} />
          </Form.Item>
          <Form.Item
            name="defaultGoal"
            label={intl.formatMessage({ id: 'workgroupTemplate.goal' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'workgroupTemplate.goalRequired' }) }]}
          >
            <Input.TextArea
              maxLength={500}
              showCount
              rows={4}
              placeholder={intl.formatMessage({ id: 'workgroupTemplate.goalPlaceholder' })}
            />
          </Form.Item>

          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'workgroupTemplate.team' })}</div>
          <EmployeeGroupMembers
            value={resources}
            onChange={setResources}
            candidateLoader={loadTemplateCandidates}
            showTeamRole={false}
            title={intl.formatMessage({ id: 'workgroupTemplate.resources' })}
            hint={intl.formatMessage({ id: 'workgroupTemplate.resourcesHint' })}
            addText={intl.formatMessage({ id: 'workgroupTemplate.selectResources' })}
            selectorTitle={intl.formatMessage({ id: 'workgroupTemplate.resourceSelector' })}
            candidateTypeLabel={(resource) =>
              resource?.agentType === '017'
                ? intl.formatMessage({ id: 'workgroupTemplate.employeeGroup' })
                : intl.formatMessage({ id: 'workgroupTemplate.employee' })
            }
          />

          <Form.Item
            name="sortOrder"
            label={intl.formatMessage({ id: 'workgroupTemplate.sortOrder' })}
            className={styles.sortField}
          >
            <InputNumber min={0} precision={0} />
          </Form.Item>
          <Form.Item name="expectedVersion" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
