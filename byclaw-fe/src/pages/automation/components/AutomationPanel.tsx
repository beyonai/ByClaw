import { Button, Empty, Form, Input, List, Modal, Spin, Switch, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  createScanSource,
  deleteScanSource,
  listScanSources,
  toggleScanSource,
  triggerScan,
  updateScanSource,
} from '@/service/devloop';
import QueryInput from '@/components/QueryInput';

interface PanelProps {
  // 挂载即视为激活；保留开关是为了将来可能的懒加载容器。
  active?: boolean;
}

// 聊天型自动化：config 存的就是 assistantChatService.chat 的入参，与后端 ScanSourceService.SOURCE_TYPE_CHAT 同值。
const CHAT_SOURCE_TYPE = 'chat';

// 列表里可能混着下线前建的渠道行（github_issue/dingtalk 等），它们的 config 不是 chat 入参。
const isChatSource = (source: any) => source?.sourceType === CHAT_SOURCE_TYPE;

// 历史数据或手改坏的 JSON 不能让编辑弹窗白屏，解析失败按空配置处理。
const parseChatConfig = (config?: string) => {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const AutomationListPanel: React.FC<PanelProps> = ({ active = true }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  // 提示词是富文本（含 @ 资源），由 QueryInput 托管，用草稿对象双向同步而非 Form 字段。
  const [promptDraft, setPromptDraft] = useState<{ text: string; resourceList: any[] }>({
    text: '',
    resourceList: [],
  });
  const [form] = Form.useForm();
  const normalizeRows = (response: any) => {
    const data = response?.data ?? response;
    if (Array.isArray(data)) return data;
    return data?.list || data?.rows || data?.records || [];
  };

  // 自动化不挂项目，不带 projectId 后端才不会按项目过滤；
  // onlyMine 让列表与编辑/删除权限同一条轴（都只认创建者），别人的自动化不出现在我的列表里。
  const buildListParams = () => ({ onlyMine: true, pageNum: 1, pageSize: 100 });

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void listScanSources(buildListParams())
      .then((response: any) => setSources(normalizeRows(response)))
      .catch((error: any) => {
        message.error(error?.message || intl.formatMessage({ id: 'automation.loadFailed' }));
        setSources([]);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intl]);

  const reload = async () => {
    setLoading(true);
    try {
      const response: any = await listScanSources(buildListParams());
      setSources(normalizeRows(response));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'automation.loadFailed' }));
    } finally {
      setLoading(false);
    }
  };

  const openEditor = (source?: any) => {
    setEditingSource(source || {});
    // 提示词由 QueryInput 自己维护富文本状态，草稿单独存，不走 Form 字段。
    const saved = parseChatConfig(source?.config);
    setPromptDraft({
      text: saved?.chatContent || '',
      resourceList: saved?.resourceList || [],
    });
    form.setFieldsValue({
      sourceName: source?.sourceName || source?.name || '',
      cronExpr: source?.cronExpr || source?.cron || '0 */1 * * * ?',
    });
  };

  const saveSource = async (values: any) => {
    const promptText = (promptDraft.text || '').trim();
    if (!promptText) {
      message.error(intl.formatMessage({ id: 'automation.promptRequired' }));
      return;
    }
    try {
      const payload = {
        sourceName: values.sourceName.trim(),
        sourceType: CHAT_SOURCE_TYPE,
        cronExpr: values.cronExpr?.trim(),
        // config 就是 chat 的入参：提示词原文 + @ 出来的资源清单，执行时后端据此还原 AssistantChatDto。
        config: JSON.stringify({
          chatContent: promptText,
          resourceList: promptDraft.resourceList || [],
        }),
      };
      if (editingSource?.sourceId) {
        await updateScanSource({ sourceId: Number(editingSource.sourceId), ...payload });
      } else {
        // 自动化是应用级的，不归属任何项目，projectId 不传（后端 project_id 可空）。
        await createScanSource(payload);
      }
      message.success(intl.formatMessage({ id: 'automation.saveSuccess' }));
      setEditingSource(null);
      form.resetFields();
      await reload();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'automation.saveFailed' }));
    }
  };

  const handleDelete = (source: any) => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'automation.deleteTitle' }),
      content: intl.formatMessage(
        { id: 'automation.deleteContent' },
        { name: source.sourceName || source.name || source.sourceId }
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteScanSource(Number(source.sourceId));
          await reload();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'automation.deleteFailed' }));
        }
      },
    });
  };

  return (
    <>
      <Spin spinning={loading}>
        {/* 新增对所有人开放：权限轴是「自动化创建者」，落在每行的编辑/删除上，服务端二次校验。 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            {intl.formatMessage({ id: 'automation.add' })}
          </Button>
        </div>
        {sources.length ? (
          <List
            dataSource={sources}
            renderItem={(source: any) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    source.sourceName ||
                    source.name ||
                    intl.formatMessage({ id: 'automation.defaultName' }, { id: source.sourceId || '' })
                  }
                  description={
                    <span>{source.sourceDescription || source.description || source.sourceType || '-'}</span>
                  }
                />
                {/* 自动化操作组件声明在文件末尾，避免把管理逻辑分散到列表渲染中。 */}
                {/* eslint-disable-next-line @typescript-eslint/no-use-before-define */}
                <SpaceActions
                  source={source}
                  // 编辑表单只会写 chat 配置，历史渠道行放进来编辑会把它的传输配置覆盖掉，所以禁编辑只留停用/删除。
                  canEdit={isChatSource(source)}
                  onEdit={() => openEditor(source)}
                  onDelete={() => handleDelete(source)}
                  onToggle={async (enabled) => {
                    await toggleScanSource(Number(source.sourceId), enabled ? '1' : '0');
                    await reload();
                  }}
                  onTrigger={async () => {
                    await triggerScan(Number(source.sourceId));
                    message.success(intl.formatMessage({ id: 'automation.triggerSuccess' }));
                  }}
                />
              </List.Item>
            )}
          />
        ) : (
          !loading && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'automation.empty' })} />
          )
        )}
      </Spin>
      <Modal
        open={editingSource !== null}
        title={intl.formatMessage({
          id: editingSource?.sourceId ? 'automation.edit' : 'automation.addTitle',
        })}
        onCancel={() => setEditingSource(null)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values) => void saveSource(values)}>
          <Form.Item
            name="sourceName"
            label={intl.formatMessage({ id: 'automation.name' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'automation.nameRequired' }) }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="cronExpr" label={intl.formatMessage({ id: 'automation.cron' })}>
            <Input placeholder="0 */1 * * * ?" />
          </Form.Item>
          {/* 提示词直接复用会话输入框：@ 数字员工、引用资源、上传都与 /chat 完全一致。
              cannotSend 隐掉发送按钮——这里是配置表单不是会话，内容靠 inputDraft 同步，落库由弹窗确定按钮触发。
              onSend 是必填 prop 但按钮已隐藏，留作回车等兜底路径，同样只写草稿不发消息。 */}
          <Form.Item label={intl.formatMessage({ id: 'automation.prompt' })} required>
            <QueryInput
              placeholder={intl.formatMessage({ id: 'automation.promptTip' })}
              minRows={4}
              maxRows={10}
              enableTaskTemplate={false}
              cannotSend
              inputDraft={promptDraft}
              onInputDraftChange={(draft) =>
                setPromptDraft({ text: draft?.text || '', resourceList: draft?.resourceList || [] })
              }
              onSend={({ queryQuestion, resourceList }) =>
                setPromptDraft({ text: queryQuestion || '', resourceList: resourceList || [] })
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

// 列表已由后端按创建者收窄（onlyMine），能看到的行就是自己的，所以这里不再判断归属；
// 越权改删仍由后端 requireSourceCreator 兜住。
function SpaceActions({
  source,
  canEdit,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
}: {
  source: any;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
  onTrigger: () => Promise<void>;
}) {
  const intl = useIntl();
  const enabled = source.enabled === '1' || source.enabled === 1 || source.enabled === true;
  const statusText = intl.formatMessage({
    id: enabled ? 'automation.enabled' : 'automation.disabled',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Tag color={enabled ? 'success' : 'default'}>{statusText}</Tag>
      <Switch size="small" checked={enabled} onChange={(value) => void onToggle(value)} />
      <Button type="text" size="small" icon={<ThunderboltOutlined />} onClick={() => void onTrigger()} />
      {canEdit ? <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} /> : null}
      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} />
    </div>
  );
}

export default AutomationListPanel;
