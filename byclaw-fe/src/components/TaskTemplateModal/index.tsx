import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Spin,
  TimePicker,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  getOperationTaskTemplate,
  listOperationTaskTemplates,
  type OperationTaskTemplate,
  type OperationTaskTemplateType,
} from '@/service/devloop';
import { queryAuthDoc } from '@/service/knowledgeCenter';
import { ResourceTypeMap } from '@/constants/resource';
import styles from './index.module.less';

export type TaskTemplateFormValues = {
  title: string;
  description: string;
  sourceMode?: 'knowledge' | 'connector' | 'internet';
  sourceKnowledge?: string | number;
  connector?: string | number;
  internetScope?: string;
  storageMode?: 'knowledge';
  targetKnowledge?: string | number;
  contentType?: string;
  audience?: string;
  platform?: string;
  account?: string | number;
  analysisScope?: string;
  range?: string;
  executorType?: 'agent' | 'group';
  agentId?: string | number;
  agentGroupId?: string | number;
  runMode?: 'once' | 'periodic' | 'interval';
  onceTime?: Dayjs | string;
  periodType?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  periodTime?: Dayjs | string;
  periodWeekdays?: number[];
  periodMonthDays?: number[];
  periodYearDateTime?: Dayjs | string;
  intervalHours?: number;
  intervalWeekdays?: number[];
  effectiveDateRange?: [Dayjs | null, Dayjs | null] | null;
};

export type TaskTemplateApplyResult = {
  template: OperationTaskTemplate;
  values: TaskTemplateFormValues;
  prompt: string;
};

type TaskTemplateOption = {
  label: string;
  value: string | number;
};

export interface TaskTemplateModalProps {
  open: boolean;
  agentOptions?: Array<{ label: string; value: string | number }>;

  /** 项目任务场景只允许选择项目绑定数字员工，不回退“当前数字员工”。 */
  agentOptionsOnly?: boolean;
  agentGroupOptions?: Array<{ label: string; value: string | number }>;
  initialTemplateType?: OperationTaskTemplateType;

  /** 会话入口展示当前项目分类，运营任务启动入口可继续使用默认标题。 */
  categoryLabel?: string;
  initialTitle?: string;
  onCancel: () => void;
  onApply: (result: TaskTemplateApplyResult) => void | Promise<void>;

  /** 运营启动场景使用独立按钮文案，聊天场景仍默认为应用到输入框。 */
  applyText?: string;
  applying?: boolean;
  initialDescription?: string;
  knowledgeOptions?: TaskTemplateOption[];

  /** 项目任务场景只允许使用项目绑定知识库，禁止回退到当前账号的全部知识库。 */
  knowledgeOptionsOnly?: boolean;
  accountOptions?: TaskTemplateOption[];
}

const DEFAULT_CONFIG: Record<OperationTaskTemplateType, TaskTemplateFormValues> = {
  collect: {
    title: '采集 AI Agent 行业案例',
    description: '采集近期企业级 AI Agent 的落地案例，提炼来源、核心场景和可复用亮点。',
    sourceMode: 'knowledge',
    sourceKnowledge: '运营素材知识库 / AI趋势',
    storageMode: 'knowledge',
    targetKnowledge: '运营素材知识库 / AI趋势 / 企业案例',
    executorType: 'agent',
    runMode: 'once',
  },
  content: {
    title: '创作 BeyondAI 实验室公众号文章',
    description: '围绕企业 AI Agent 实践创作一篇面向企业管理者的深度文章，包含案例与行动建议。',
    contentType: '公众号文章',
    audience: '企业管理者与 AI 产品负责人',
    executorType: 'agent',
    runMode: 'once',
  },
  publish: {
    title: '发布已审核内容',
    description: '将已审核内容发布到指定账号，发布前再次检查标题、封面和品牌口径。',
    platform: '微信公众号',
    account: 'BeyondAI实验室',
    executorType: 'agent',
    runMode: 'once',
  },
  analyze: {
    title: '运营数据分析与优化',
    description: '分析近 30 天账号与作品表现，识别高表现内容并输出下一周期优化建议。',
    analysisScope: '账号整体分析',
    range: '近 30 天',
    executorType: 'agent',
    runMode: 'once',
  },
};

const DEFAULT_KNOWLEDGE_OPTIONS = [
  '运营素材知识库 / AI趋势',
  '行业案例知识库 / 企业服务',
  '品牌内容知识库 / 历史文章',
].map((value) => ({ label: value, value }));
const DEFAULT_ACCOUNT_OPTIONS = ['BeyondAI实验室', '百应AI服务号'].map((value) => ({ label: value, value }));
const CONNECTOR_OPTIONS = ['钉钉', '企业微信', '飞书'].map((value) => ({ label: value, value }));
const WEEKDAY_OPTIONS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => ({
  label,
  value: index + 1,
}));
const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({ label: `${index + 1}日`, value: index + 1 }));

const resolveInitialOptionValue = (
  options: TaskTemplateOption[],
  currentValue: string | number | undefined
): string | number | undefined => {
  if (currentValue === undefined || currentValue === null) return undefined;
  if (!options.length || options.some((option) => `${option.value}` === `${currentValue}`)) return currentValue;
  return options[0].value;
};

const parseTemplateConfig = (template: OperationTaskTemplate): TaskTemplateFormValues => {
  try {
    const rawConfig =
      typeof template.config === 'string'
        ? JSON.parse(template.config)
        : template.config && typeof template.config === 'object'
          ? template.config
          : {};
    const config = { ...rawConfig };
    ['ontology', 'sourceOntology', 'knowledgeOrganization', 'organizeTemplateId', 'organize'].forEach((key) => {
      delete config[key];
    });
    return { ...(DEFAULT_CONFIG[template.templateType] || DEFAULT_CONFIG.collect), ...config };
  } catch {
    return DEFAULT_CONFIG[template.templateType] || DEFAULT_CONFIG.collect;
  }
};

const findOptionLabel = (options: TaskTemplateOption[], value: string | number | undefined, fallback = '-') => {
  return (
    options.find((option) => `${option.value}` === `${value}`)?.label || (value === undefined ? fallback : `${value}`)
  );
};

const buildTemplatePrompt = (
  template: OperationTaskTemplate,
  values: TaskTemplateFormValues,
  options: {
    agents: TaskTemplateOption[];
    groups: TaskTemplateOption[];
    knowledgeBases: TaskTemplateOption[];
    accounts: TaskTemplateOption[];
  }
) => {
  const detailLines: string[] = [];
  if (template.templateType === 'collect') {
    const sourceModeLabel = { knowledge: '知识库采集', connector: '连接器采集', internet: '互联网采集' }[
      values.sourceMode || 'knowledge'
    ];
    const source =
      values.sourceMode === 'connector'
        ? values.connector
        : values.sourceMode === 'internet'
          ? values.internetScope
          : values.sourceKnowledge;
    const sourceLabel =
      values.sourceMode === 'knowledge'
        ? findOptionLabel(options.knowledgeBases, source as string | number | undefined)
        : source || '-';
    const target = `知识库：${findOptionLabel(options.knowledgeBases, values.targetKnowledge)}`;
    detailLines.push(`采集方式：${sourceModeLabel}`, `采集来源：${sourceLabel}`, `入库位置：${target}`);
  } else if (template.templateType === 'content') {
    detailLines.push(`内容类型：${values.contentType || '-'}`, `目标受众：${values.audience || '-'}`);
  } else if (template.templateType === 'publish') {
    detailLines.push(
      `发布平台：${values.platform || '-'}`,
      `发布账号：${findOptionLabel(options.accounts, values.account)}`
    );
  } else {
    detailLines.push(`分析范围：${values.analysisScope || '-'}`, `时间范围：${values.range || '-'}`);
  }

  const executor =
    values.executorType === 'group'
      ? findOptionLabel(options.groups, values.agentGroupId, '数字员工组')
      : findOptionLabel(options.agents, values.agentId, '数字员工');
  const formatValue = (value: unknown, format = 'YYYY-MM-DD HH:mm') =>
    dayjs.isDayjs(value) ? value.format(format) : value ? String(value) : '-';
  const weekdays = (values.periodWeekdays || values.intervalWeekdays || [])
    .map((value) => WEEKDAY_OPTIONS.find((option) => option.value === value)?.label || value)
    .join('、');
  const periodTypeLabel =
    ({ daily: '每天', weekly: '每周', biweekly: '每双周', monthly: '每月', yearly: '每年' } as Record<string, string>)[
      values.periodType || ''
    ] || '待设置周期';
  const runMode =
    values.runMode === 'periodic'
      ? `按周期执行：${periodTypeLabel} ${
        values.periodType === 'yearly'
          ? formatValue(values.periodYearDateTime, 'MM-DD HH:mm')
          : formatValue(values.periodTime, 'HH:mm')
      }${weekdays ? `（${weekdays}）` : ''}`
      : values.runMode === 'interval'
        ? `按间隔执行：每 ${values.intervalHours || 1} 小时${weekdays ? `（${weekdays}）` : ''}`
        : values.runMode === 'once'
          ? `单次执行：${formatValue(values.onceTime)}`
          : '单次执行';
  return [
    '请执行以下运营任务：',
    '',
    `任务模板：${template.templateName}`,
    `任务名称：${values.title}`,
    `任务要求：${values.description}`,
    ...detailLines,
    `执行主体：${executor || '数字员工'}`,
    `执行方式：${runMode}`,
    '',
    '请先确认理解任务与所需资源，再开始执行；执行过程中同步关键进展，并将成果保存到当前会话。',
  ].join('\n');
};

const TaskTemplateModal: React.FC<TaskTemplateModalProps> = ({
  open,
  agentOptions = [],
  agentOptionsOnly = false,
  agentGroupOptions = [],
  initialTemplateType,
  categoryLabel,
  initialTitle,
  onCancel,
  onApply,
  applyText = '确定应用到对话框',
  applying = false,
  initialDescription,
  knowledgeOptions = [],
  knowledgeOptionsOnly = false,
  accountOptions = [],
}) => {
  const [form] = Form.useForm<TaskTemplateFormValues>();
  const [templates, setTemplates] = useState<OperationTaskTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<OperationTaskTemplate>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [fetchedKnowledgeOptions, setFetchedKnowledgeOptions] = useState<TaskTemplateOption[]>([]);
  const sourceMode = Form.useWatch('sourceMode', form);
  const connector = Form.useWatch('connector', form);
  const executorType = Form.useWatch('executorType', form);
  const runMode = Form.useWatch('runMode', form);
  const periodType = Form.useWatch('periodType', form);

  useEffect(() => {
    // 切换到连接器采集后，若模板没有保存连接器，则默认选择第一个可用连接器。
    if (selectedTemplate?.templateType !== 'collect' || sourceMode !== 'connector' || connector) return;
    form.setFieldValue('connector', CONNECTOR_OPTIONS[0]?.value);
  }, [connector, form, selectedTemplate, sourceMode]);

  useEffect(() => {
    if (!open) return;
    setSelectedTemplate(undefined);
    setApplyingTemplate(false);
    form.resetFields();
    setLoading(true);
    void listOperationTaskTemplates(initialTemplateType)
      .then((response) => {
        const rows = Array.isArray(response) ? response : [];
        setTemplates(rows.filter((item) => !['knowledge', 'object_discovery'].includes(item.templateType)));
      })
      .catch((error: any) => message.error(error?.message || '任务模板加载失败'))
      .finally(() => setLoading(false));
    // 未由调用方传入知识库时，按当前账号可读范围拉取（type=all），避免展示固定示例数据。
    if (!knowledgeOptions.length && !knowledgeOptionsOnly) {
      const query = {
        pageNum: 1,
        pageSize: 1000,
        resourceBizTypes: [
          ResourceTypeMap.knowledgeBase,
          ResourceTypeMap.knowledgeBaseQa,
          ResourceTypeMap.knowledgeBaseTerm,
        ],
        type: 'all',
      };
      void queryAuthDoc(query).then((response) => {
        const rows = response?.rows || response?.list || response?.data?.rows || response?.data?.list || [];
        const unique = new Map<string, TaskTemplateOption>();
        rows.forEach((item: any) => {
          const value = item.resourceId ?? item.resourceSourcePkId ?? item.datasetId ?? item.id;
          const label = item.resourceName || item.datasetName || item.name;
          if (value !== undefined && label) unique.set(`${value}`, { value, label });
        });
        setFetchedKnowledgeOptions(Array.from(unique.values()));
      });
    }
    // 每次打开都重新读取启用模板，避免后台停用后仍展示旧缓存；详情仍由用户从目录中选择。
  }, [form, initialTemplateType, knowledgeOptions.length, knowledgeOptionsOnly, open]);

  const openTemplateDetail = async (template: OperationTaskTemplate) => {
    setDetailLoading(true);
    try {
      const detail = await getOperationTaskTemplate(template.templateId);
      if (!detail || ['knowledge', 'object_discovery'].includes(detail.templateType)) {
        message.warning('该任务模板已下线，请重新选择');
        return;
      }
      const resolvedTemplate = detail;
      const templateValues = parseTemplateConfig(resolvedTemplate);
      const toDateTime = (value: unknown) => {
        if (!value) return undefined;
        const parsed = dayjs(value as string);
        return parsed.isValid() ? parsed : undefined;
      };
      const resolvedKnowledgeOptions = knowledgeOptionsOnly
        ? knowledgeOptions
        : knowledgeOptions.length
          ? knowledgeOptions
          : fetchedKnowledgeOptions.length
            ? fetchedKnowledgeOptions
            : DEFAULT_KNOWLEDGE_OPTIONS;
      const resolvedAccountOptions = accountOptions.length ? accountOptions : DEFAULT_ACCOUNT_OPTIONS;
      setSelectedTemplate(resolvedTemplate);
      form.setFieldsValue({
        ...templateValues,
        // 采集类模板每次打开均默认选择界面中的第一个采集方式和入库方式。
        ...(resolvedTemplate.templateType === 'collect'
          ? {
            sourceMode: 'connector' as const,
            storageMode: 'knowledge' as const,
          }
          : {}),
        ...(initialTitle ? { title: initialTitle } : {}),
        ...(initialDescription ? { description: initialDescription } : {}),
        sourceKnowledge: resolveInitialOptionValue(resolvedKnowledgeOptions, templateValues.sourceKnowledge),
        targetKnowledge: resolveInitialOptionValue(resolvedKnowledgeOptions, templateValues.targetKnowledge),
        account: resolveInitialOptionValue(resolvedAccountOptions, templateValues.account),
        agentId: agentOptions[0]?.value || (agentOptionsOnly ? undefined : '当前数字员工'),
        agentGroupId: agentGroupOptions[0]?.value,
        // 单次执行使用打开模板时的当前时间，避免复用模板配置中的历史绝对时间。
        onceTime: dayjs(),
        periodTime: toDateTime(templateValues.periodTime),
        periodYearDateTime: toDateTime(templateValues.periodYearDateTime),
      });
    } catch (error: any) {
      message.error(error?.message || '任务模板详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const title = selectedTemplate
    ? selectedTemplate.templateName
    : categoryLabel
      ? `${categoryLabel} · 选择任务模板`
      : '选择任务模板';
  const subtitle = selectedTemplate ? '完善结构化任务信息和执行配置' : '用结构化信息精准描述任务，数字员工会据此执行';
  const fallbackAgentOptions = useMemo(
    () =>
      agentOptionsOnly
        ? agentOptions
        : agentOptions.length
          ? agentOptions
          : [{ label: '当前数字员工', value: '当前数字员工' }],
    [agentOptions, agentOptionsOnly]
  );
  const availableGroupOptions = useMemo(
    () => agentGroupOptions.filter((option) => option.value !== undefined && option.value !== null),
    [agentGroupOptions]
  );
  const availableKnowledgeOptions = useMemo(
    () =>
      knowledgeOptionsOnly
        ? knowledgeOptions
        : knowledgeOptions.length
          ? knowledgeOptions
          : fetchedKnowledgeOptions.length
            ? fetchedKnowledgeOptions
            : DEFAULT_KNOWLEDGE_OPTIONS,
    [fetchedKnowledgeOptions, knowledgeOptions, knowledgeOptionsOnly]
  );
  const availableAccountOptions = useMemo(
    () => (accountOptions.length ? accountOptions : DEFAULT_ACCOUNT_OPTIONS),
    [accountOptions]
  );

  const applyTemplate = async () => {
    if (!selectedTemplate) return;
    setApplyingTemplate(true);
    try {
      const values = await form.validateFields();
      const submitValues: TaskTemplateFormValues = { ...values };
      const prompt = buildTemplatePrompt(selectedTemplate, values, {
        agents: fallbackAgentOptions,
        groups: availableGroupOptions,
        knowledgeBases: availableKnowledgeOptions,
        accounts: availableAccountOptions,
      });
      await onApply({ template: selectedTemplate, values: submitValues, prompt });
    } catch (error: any) {
      // 运营启动失败由父组件提示并保留当前模板草稿；表单校验错误由 Form 自己展示。
      if (error?.errorFields) return;
    } finally {
      setApplyingTemplate(false);
    }
  };

  const renderTypeFields = () => {
    if (!selectedTemplate) return null;
    if (selectedTemplate.templateType === 'collect') {
      return (
        <>
          <div className={styles.sourceMethodRow}>
            <div className={styles.methodField}>
              <strong>采集方式</strong>
              <Form.Item name="sourceMode">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="connector">连接器采集</Radio.Button>
                  <Radio.Button value="internet">互联网采集</Radio.Button>
                  <Radio.Button value="knowledge">知识库采集</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>
            {sourceMode === 'connector' ? (
              <Form.Item
                className={styles.methodConfigField}
                label="连接器"
                name="connector"
                rules={[{ required: true, message: '请选择连接器' }]}
              >
                <Select options={CONNECTOR_OPTIONS} />
              </Form.Item>
            ) : sourceMode === 'internet' ? (
              <Form.Item
                className={styles.methodConfigField}
                label="搜索范围"
                name="internetScope"
                rules={[{ required: true, message: '请输入搜索范围' }]}
              >
                <Input placeholder="公开网页、行业媒体与公众号文章" />
              </Form.Item>
            ) : (
              <Form.Item
                className={styles.methodConfigField}
                label="来源知识库"
                name="sourceKnowledge"
                rules={[{ required: true, message: '请选择来源知识库' }]}
              >
                <Select options={availableKnowledgeOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            )}
          </div>
          <div className={styles.storageMethodRow}>
            <div className={styles.methodField}>
              <strong>入库方式</strong>
              <Form.Item name="storageMode">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="knowledge">知识库</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>
            <Form.Item
              className={styles.methodConfigField}
              label="目标知识库"
              name="targetKnowledge"
              rules={[{ required: true, message: '请选择目标知识库' }]}
            >
              <Select options={availableKnowledgeOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          </div>
        </>
      );
    }
    if (selectedTemplate.templateType === 'content') {
      return (
        <div className={styles.formGrid}>
          <Form.Item label="内容类型" name="contentType">
            <Select options={['公众号文章', '小红书图文', '短视频脚本'].map((value) => ({ label: value, value }))} />
          </Form.Item>
          <Form.Item label="目标受众" name="audience">
            <Input />
          </Form.Item>
        </div>
      );
    }
    if (selectedTemplate.templateType === 'publish') {
      return (
        <div className={styles.formGrid}>
          <Form.Item label="发布平台" name="platform">
            <Select
              options={['微信公众号', '小红书', '微信视频号', '抖音'].map((value) => ({ label: value, value }))}
            />
          </Form.Item>
          <Form.Item label="发布账号" name="account">
            <Select options={availableAccountOptions} showSearch optionFilterProp="label" />
          </Form.Item>
        </div>
      );
    }
    return (
      <div className={styles.formGrid}>
        <Form.Item label="分析范围" name="analysisScope">
          <Select options={['账号整体分析', '指定作品分析'].map((value) => ({ label: value, value }))} />
        </Form.Item>
        <Form.Item label="时间范围" name="range">
          <Select options={['近 7 天', '近 30 天', '本季度'].map((value) => ({ label: value, value }))} />
        </Form.Item>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      width={900}
      centered
      destroyOnClose
      className={styles.modal}
      title={
        <div className={styles.modalTitle}>
          {selectedTemplate && (
            <Button
              type="text"
              icon={<LeftOutlined />}
              disabled={applying || applyingTemplate}
              onClick={() => setSelectedTemplate(undefined)}
            />
          )}
          <span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
      }
      footer={
        selectedTemplate
          ? [
            <Button key="back" disabled={applying || applyingTemplate} onClick={() => setSelectedTemplate(undefined)}>
              返回模板
            </Button>,
            <Button
              key="apply"
              type="primary"
              loading={applying || applyingTemplate}
              onClick={() => void applyTemplate()}
            >
              {applyText}
            </Button>,
          ]
          : null
      }
      closable={!applying && !applyingTemplate}
      maskClosable={!applying && !applyingTemplate}
      keyboard={!applying && !applyingTemplate}
      onCancel={onCancel}
    >
      <Spin spinning={loading || detailLoading}>
        {selectedTemplate ? (
          <Form form={form} layout="vertical" className={styles.detailForm}>
            <Form.Item
              label="任务名称"
              name="title"
              rules={[{ required: true, whitespace: true, message: '请输入任务名称' }]}
            >
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item
              label={selectedTemplate.templateType === 'collect' ? '采集内容描述' : '任务要求'}
              name="description"
              rules={[{ required: true, whitespace: true, message: '请输入任务要求' }]}
            >
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
            {renderTypeFields()}
            <section className={styles.executionSection}>
              <strong>执行配置</strong>
              <div className={styles.executionGrid}>
                <Form.Item label="执行主体" name="executorType" rules={[{ required: true, message: '请选择执行主体' }]}>
                  <Select
                    options={[
                      { label: '数字员工', value: 'agent' },
                      { label: '数字员工组（暂无可用）', value: 'group', disabled: !availableGroupOptions.length },
                    ]}
                  />
                </Form.Item>
                {executorType === 'group' ? (
                  <Form.Item
                    label="选择数字员工组"
                    name="agentGroupId"
                    rules={[{ required: true, message: '请选择数字员工组' }]}
                  >
                    <Select options={availableGroupOptions} notFoundContent="暂无可用数字员工组" />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="选择数字员工"
                    name="agentId"
                    rules={[{ required: true, message: '请选择数字员工' }]}
                  >
                    <Select options={fallbackAgentOptions} showSearch optionFilterProp="label" />
                  </Form.Item>
                )}
                <Form.Item
                  className={styles.executionModeField}
                  label="执行方式"
                  name="runMode"
                  rules={[{ required: true, message: '请选择执行方式' }]}
                >
                  <Select
                    options={[
                      { label: '单次执行', value: 'once' },
                      { label: '按周期执行', value: 'periodic' },
                      { label: '按间隔执行', value: 'interval' },
                    ]}
                  />
                </Form.Item>
                {runMode === 'once' && (
                  <Form.Item label="执行时间" name="onceTime" rules={[{ required: true, message: '请选择执行时间' }]}>
                    <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                )}
                {runMode === 'periodic' && (
                  <>
                    <Form.Item
                      label="周期类型"
                      name="periodType"
                      rules={[{ required: true, message: '请选择周期类型' }]}
                    >
                      <Select
                        options={[
                          { label: '每天', value: 'daily' },
                          { label: '每周', value: 'weekly' },
                          { label: '每双周', value: 'biweekly' },
                          { label: '每月', value: 'monthly' },
                          { label: '每年', value: 'yearly' },
                        ]}
                      />
                    </Form.Item>
                    {periodType === 'yearly' ? (
                      <Form.Item
                        label="月日时分"
                        name="periodYearDateTime"
                        rules={[{ required: true, message: '请选择月日时分' }]}
                      >
                        <DatePicker showTime={{ format: 'HH:mm' }} format="MM-DD HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    ) : (
                      <Form.Item
                        label="执行时分"
                        name="periodTime"
                        rules={[{ required: true, message: '请选择执行时分' }]}
                      >
                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    )}
                    {(periodType === 'weekly' || periodType === 'biweekly') && (
                      <Form.Item
                        label="执行日"
                        name="periodWeekdays"
                        rules={[{ required: true, type: 'array', min: 1, message: '请选择执行日' }]}
                      >
                        <Select mode="multiple" options={WEEKDAY_OPTIONS} />
                      </Form.Item>
                    )}
                    {periodType === 'monthly' && (
                      <Form.Item
                        label="执行日期"
                        name="periodMonthDays"
                        rules={[{ required: true, type: 'array', min: 1, message: '请选择执行日期' }]}
                      >
                        <Select mode="multiple" options={MONTH_DAY_OPTIONS} />
                      </Form.Item>
                    )}
                    <Form.Item label="生效日期区间" name="effectiveDateRange">
                      <DatePicker.RangePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                )}
                {runMode === 'interval' && (
                  <>
                    <Form.Item
                      label="每几小时"
                      name="intervalHours"
                      rules={[{ required: true, message: '请输入间隔小时数' }]}
                    >
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      label="执行日"
                      name="intervalWeekdays"
                      rules={[{ required: true, type: 'array', min: 1, message: '请选择执行日' }]}
                    >
                      <Select mode="multiple" options={WEEKDAY_OPTIONS} />
                    </Form.Item>
                    <Form.Item label="生效日期区间" name="effectiveDateRange">
                      <DatePicker.RangePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                )}
              </div>
            </section>
          </Form>
        ) : templates.length ? (
          <div className={styles.templateGrid}>
            {templates.map((template) => (
              <button
                key={template.templateId}
                type="button"
                className={styles.templateCard}
                onClick={() => void openTemplateDetail(template)}
              >
                {/* 模板标记直接取名称前两个字，不再维护无业务含义的数据库 icon 字段。 */}
                <i>{template.templateName.slice(0, 2)}</i>
                <span>
                  <strong>{template.templateName}</strong>
                  <small>{template.description}</small>
                </span>
                <RightOutlined style={{ color: '#b8c1ce' }} />
              </button>
            ))}
          </div>
        ) : !loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用任务模板" />
        ) : null}
      </Spin>
    </Modal>
  );
};

export default TaskTemplateModal;
