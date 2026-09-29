import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
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
    return <Alert type="warning" message="仅开源版 adminvip 可访问工作组模板管理。" />;
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
          <h1>工作组模板</h1>
          <p>配置创建工作组时可直接选择的场景模板、资产目录与数字员工阵容。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          新建模板
        </Button>
      </div>

      <Table
        loading={loading}
        rowKey={(item) => item.template.templateId}
        dataSource={items}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        columns={[
          {
            title: '模板',
            render: (_, item) => (
              <div className={styles.templateCell}>
                <strong>{item.template.templateName}</strong>
                <span>{item.template.summary}</span>
              </div>
            ),
          },
          { title: '资产目录', dataIndex: 'catalogName', width: 180 },
          {
            title: '数字员工阵容',
            width: 260,
            render: (_, item) =>
              item.available === false ? (
                <span className={styles.unavailable}>{item.unavailableReason || '关联资源不可用'}</span>
              ) : (
                <Space size={[4, 4]} wrap>
                  {item.resources.map((resource) => (
                    <Tag key={resource.resourceId}>{resource.resourceName}</Tag>
                  ))}
                </Space>
              ),
          },
          {
            title: '操作',
            width: 150,
            render: (_, item) => (
              <Space size={0}>
                <Button type="link" onClick={() => edit(item)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除这个工作组模板吗？"
                  description="删除后，创建工作组时将无法再选择该模板。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true, loading: deletingId === item.template.templateId }}
                  onConfirm={async () => {
                    setDeletingId(item.template.templateId);
                    try {
                      await deleteManagedWorkgroupTemplate(item.template.templateId, item.template.version);
                      message.success('模板已删除');
                      await reload();
                    } catch {
                      message.error('模板删除失败');
                    } finally {
                      setDeletingId(undefined);
                    }
                  }}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        className={styles.editorModal}
        title={editing ? '编辑工作组模板' : '新建工作组模板'}
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={860}
        okText="保存模板"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          className={styles.form}
          onFinish={async (values) => {
            if (savingRef.current) return;
            if (!resources.length) {
              message.warning('请至少选择一个数字员工或数字员工组');
              return;
            }
            const payload = { ...values, resourceIds: resources.map((resource) => resource.resourceId) };
            savingRef.current = true;
            setSaving(true);
            try {
              if (editing) await updateManagedWorkgroupTemplate(editing.template.templateId, payload);
              else await createManagedWorkgroupTemplate(payload);
              message.success('模板保存成功');
              close();
              await reload();
            } catch {
              message.error('模板保存失败');
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
        >
          <div className={styles.sectionTitle}>基本信息</div>
          <div className={styles.twoColumns}>
            <Form.Item name="templateName" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
              <Input maxLength={100} placeholder="例如：品牌内容创作小组" />
            </Form.Item>
            <Form.Item name="catalogId" label="资产目录" rules={[{ required: true, message: '请选择资产目录' }]}>
              <TreeSelect
                treeDataSimpleMode
                treeData={toCatalogTreeData(catalogs)}
                showSearch
                treeNodeFilterProp="title"
                placeholder="选择资产目录管理中的目录"
              />
            </Form.Item>
          </div>
          <Form.Item name="summary" label="模板摘要" rules={[{ required: true, message: '请输入模板摘要' }]}>
            <Input.TextArea maxLength={500} showCount rows={3} placeholder="简要说明模板适用的协作场景" />
          </Form.Item>

          <div className={styles.sectionTitle}>创建后默认内容</div>
          <Form.Item
            name="defaultGroupName"
            label="默认工作组名称"
            rules={[{ required: true, message: '请输入默认工作组名称' }]}
          >
            <Input maxLength={100} placeholder="用户选择模板后可继续修改" />
          </Form.Item>
          <Form.Item
            name="defaultGoal"
            label="默认工作目标"
            rules={[{ required: true, message: '请输入默认工作目标' }]}
          >
            <Input.TextArea maxLength={500} showCount rows={4} placeholder="描述团队要共同完成的目标" />
          </Form.Item>

          <div className={styles.sectionTitle}>数字员工阵容</div>
          <EmployeeGroupMembers
            value={resources}
            onChange={setResources}
            candidateLoader={loadTemplateCandidates}
            showTeamRole={false}
            title="模板资源"
            hint="选择单个数字员工或数字员工组；创建工作组时，组资源会自动展开为组内成员"
            addText="选择资源"
            selectorTitle="选择数字员工或数字员工组"
            candidateTypeLabel={(resource) => (resource?.agentType === '017' ? '数字员工组' : '数字员工')}
          />

          <Form.Item name="sortOrder" label="排序" className={styles.sortField}>
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
