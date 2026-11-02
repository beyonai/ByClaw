// 用户可见提示在使用时读取当前语言，接口值与用户内容保持原样。
import { useIntl, getIntl } from '@umijs/max';
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
import { taskTemplateOptionLabel } from './optionLabels';

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

// 仅缺省字段使用当前语言，已有模板配置始终覆盖默认内容。
const getDefaultConfig = (): Record<OperationTaskTemplateType, TaskTemplateFormValues> => ({
  collect: {
    title: getIntl().formatMessage({ id: 'taskTemplate.defaults.collect.title' }),
    description: getIntl().formatMessage({ id: 'taskTemplate.defaults.collect.description' }),
    sourceMode: 'knowledge',
    sourceKnowledge: '运营素材知识库 / AI趋势',
    storageMode: 'knowledge',
    targetKnowledge: '运营素材知识库 / AI趋势 / 企业案例',
    executorType: 'agent',
    runMode: 'once',
  },
  content: {
    title: getIntl().formatMessage({ id: 'taskTemplate.defaults.content.title' }),
    description: getIntl().formatMessage({ id: 'taskTemplate.defaults.content.description' }),
    contentType: '公众号文章',
    audience: getIntl().formatMessage({ id: 'taskTemplate.defaults.content.audience' }),
    executorType: 'agent',
    runMode: 'once',
  },
  publish: {
    title: getIntl().formatMessage({ id: 'taskTemplate.defaults.publish.title' }),
    description: getIntl().formatMessage({ id: 'taskTemplate.defaults.publish.description' }),
    platform: '微信公众号',
    account: 'BeyondAI实验室',
    executorType: 'agent',
    runMode: 'once',
  },
  analyze: {
    title: getIntl().formatMessage({ id: 'taskTemplate.defaults.analyze.title' }),
    description: getIntl().formatMessage({ id: 'taskTemplate.defaults.analyze.description' }),
    analysisScope: '账号整体分析',
    range: '近 30 天',
    executorType: 'agent',
    runMode: 'once',
  },
});

const DEFAULT_KNOWLEDGE_OPTIONS = [
  '运营素材知识库 / AI趋势',
  '行业案例知识库 / 企业服务',
  '品牌内容知识库 / 历史文章',
].map((value) => ({ label: value, value }));
const DEFAULT_ACCOUNT_OPTIONS = ['BeyondAI实验室', '百应AI服务号'].map((value) => ({ label: value, value }));
// 选项值是历史配置的协议值，只翻译展示标签。
const getConnectorOptions = () =>
  ['钉钉', '企业微信', '飞书'].map((value) => ({ label: taskTemplateOptionLabel(value), value }));
const getWeekdayOptions = () =>
  [
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.1' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.2' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.3' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.4' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.5' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.6' }),
    getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.7' }),
  ].map((label, index) => ({
    label,
    value: index + 1,
  }));
const getMonthDayOptions = () =>
  Array.from({ length: 31 }, (_, index) => ({
    label: getIntl().formatMessage({ id: 'taskTemplate.monthDay' }, { v0: index + 1 }),
    value: index + 1,
  }));

const resolveInitialOptionValue = (
  options: TaskTemplateOption[],
  currentValue: string | number | undefined
): string | number | undefined => {
  if (currentValue === undefined || currentValue === null) return undefined;
  if (!options.length || options.some((option) => `${option.value}` === `${currentValue}`)) return currentValue;
  return options[0].value;
};

const parseTemplateConfig = (template: OperationTaskTemplate): TaskTemplateFormValues => {
  const defaults = getDefaultConfig();
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
    return { ...(defaults[template.templateType] || defaults.collect), ...config };
  } catch {
    return defaults[template.templateType] || defaults.collect;
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
    const sourceModeLabel = {
      knowledge: getIntl().formatMessage({ id: 'taskTemplate.source.knowledge' }),
      connector: getIntl().formatMessage({ id: 'taskTemplate.source.connector' }),
      internet: getIntl().formatMessage({ id: 'taskTemplate.source.internet' }),
    }[values.sourceMode || 'knowledge'];
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
    const target = getIntl().formatMessage(
      { id: 'ui.task.knowledgeTarget' },
      { v0: findOptionLabel(options.knowledgeBases, values.targetKnowledge) }
    );
    detailLines.push(
      getIntl().formatMessage({ id: 'taskTemplate.prompt.sourceMode' }, { v0: sourceModeLabel }),
      getIntl().formatMessage({ id: 'taskTemplate.prompt.source' }, { v0: sourceLabel }),
      getIntl().formatMessage({ id: 'taskTemplate.prompt.target' }, { v0: target })
    );
  } else if (template.templateType === 'content') {
    detailLines.push(
      getIntl().formatMessage(
        { id: 'taskTemplate.prompt.contentType' },
        { v0: taskTemplateOptionLabel(values.contentType || '-') }
      ),
      getIntl().formatMessage({ id: 'taskTemplate.prompt.audience' }, { v0: values.audience || '-' })
    );
  } else if (template.templateType === 'publish') {
    detailLines.push(
      getIntl().formatMessage(
        { id: 'taskTemplate.prompt.platform' },
        { v0: taskTemplateOptionLabel(values.platform || '-') }
      ),
      getIntl().formatMessage(
        { id: 'taskTemplate.prompt.account' },
        { v0: findOptionLabel(options.accounts, values.account) }
      )
    );
  } else {
    detailLines.push(
      getIntl().formatMessage(
        { id: 'taskTemplate.prompt.scope' },
        { v0: taskTemplateOptionLabel(values.analysisScope || '-') }
      ),
      getIntl().formatMessage({ id: 'taskTemplate.prompt.range' }, { v0: taskTemplateOptionLabel(values.range || '-') })
    );
  }

  const executor =
    values.executorType === 'group'
      ? findOptionLabel(
        options.groups,
        values.agentGroupId,
        getIntl().formatMessage({ id: 'projectSpace.members.agentTabGroup' })
      )
      : findOptionLabel(
        options.agents,
        values.agentId,
        getIntl().formatMessage({ id: 'projectTaskDetail.simple.agent' })
      );
  const formatValue = (value: unknown, format = 'YYYY-MM-DD HH:mm') =>
    dayjs.isDayjs(value) ? value.format(format) : value ? String(value) : '-';
  const weekdays = (values.periodWeekdays || values.intervalWeekdays || [])
    .map((value) => getWeekdayOptions().find((option) => option.value === value)?.label || value)
    .join('、');
  const periodTypeLabel =
    (
      {
        daily: getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.daily' }),
        weekly: getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.weekly' }),
        biweekly: getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.biweekly' }),
        monthly: getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.monthly' }),
        yearly: getIntl().formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.yearly' }),
      } as Record<string, string>
    )[values.periodType || ''] || getIntl().formatMessage({ id: 'taskTemplate.period.unset' });
  const runMode =
    values.runMode === 'periodic'
      ? getIntl().formatMessage(
        { id: 'taskTemplate.prompt.periodic' },
        {
          v0: periodTypeLabel,
          v1:
              values.periodType === 'yearly'
                ? formatValue(values.periodYearDateTime, 'MM-DD HH:mm')
                : formatValue(values.periodTime, 'HH:mm'),
          v2: weekdays ? `（${weekdays}）` : '',
        }
      )
      : values.runMode === 'interval'
        ? getIntl().formatMessage(
          { id: 'taskTemplate.prompt.interval' },
          { v0: values.intervalHours || 1, v1: weekdays ? `（${weekdays}）` : '' }
        )
        : values.runMode === 'once'
          ? getIntl().formatMessage({ id: 'taskTemplate.prompt.once' }, { v0: formatValue(values.onceTime) })
          : getIntl().formatMessage({ id: 'taskTemplate.run.once' });
  return [
    getIntl().formatMessage({ id: 'taskTemplate.prompt.intro' }),
    '',
    getIntl().formatMessage({ id: 'taskTemplate.prompt.template' }, { v0: template.templateName }),
    getIntl().formatMessage({ id: 'taskTemplate.prompt.title' }, { v0: values.title }),
    getIntl().formatMessage({ id: 'taskTemplate.prompt.requirements' }, { v0: values.description }),
    ...detailLines,
    getIntl().formatMessage(
      { id: 'taskTemplate.prompt.executor' },
      { v0: executor || getIntl().formatMessage({ id: 'projectTaskDetail.simple.agent' }) }
    ),
    getIntl().formatMessage({ id: 'taskTemplate.prompt.runMode' }, { v0: runMode }),
    '',
    getIntl().formatMessage({ id: 'taskTemplate.prompt.instructions' }),
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
  applyText,
  applying = false,
  initialDescription,
  knowledgeOptions = [],
  knowledgeOptionsOnly = false,
  accountOptions = [],
}) => {
  // 界面文案随当前语言更新，业务名称与接口数据保持原值。
  const intl = useIntl();
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
    form.setFieldValue('connector', getConnectorOptions()[0]?.value);
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
      .catch((error: any) => message.error(error?.message || intl.formatMessage({ id: 'taskTemplate.loadFailed' })))
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
        message.warning(intl.formatMessage({ id: 'ui.task.retired' }));
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
      message.error(error?.message || intl.formatMessage({ id: 'taskTemplate.detailFailed' }));
    } finally {
      setDetailLoading(false);
    }
  };

  const title = selectedTemplate
    ? selectedTemplate.templateName
    : categoryLabel
      ? intl.formatMessage({ id: 'taskTemplate.categoryTitle' }, { v0: categoryLabel })
      : intl.formatMessage({ id: 'taskTemplate.select' });
  const subtitle = selectedTemplate
    ? intl.formatMessage({ id: 'taskTemplate.detailsSubtitle' })
    : intl.formatMessage({ id: 'taskTemplate.selectSubtitle' });
  const fallbackAgentOptions = useMemo(
    () =>
      agentOptionsOnly
        ? agentOptions
        : agentOptions.length
          ? agentOptions
          : [{ label: intl.formatMessage({ id: 'sider.currentDigitalEmployee' }), value: '当前数字员工' }],
    [agentOptions, agentOptionsOnly, intl]
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
              <strong>{intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectMode' })}</strong>
              <Form.Item name="sourceMode">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="connector">
                    {intl.formatMessage({ id: 'taskTemplate.source.connector' })}
                  </Radio.Button>
                  <Radio.Button value="internet">
                    {intl.formatMessage({ id: 'taskTemplate.source.internet' })}
                  </Radio.Button>
                  <Radio.Button value="knowledge">
                    {intl.formatMessage({ id: 'taskTemplate.source.knowledge' })}
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>
            {sourceMode === 'connector' ? (
              <Form.Item
                className={styles.methodConfigField}
                label={intl.formatMessage({ id: 'queryInput.tools.connector' })}
                name="connector"
                rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectConnector' }) }]}
              >
                <Select options={getConnectorOptions()} />
              </Form.Item>
            ) : sourceMode === 'internet' ? (
              <Form.Item
                className={styles.methodConfigField}
                label={intl.formatMessage({ id: 'taskTemplate.searchScope' })}
                name="internetScope"
                rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.enterSearchScope' }) }]}
              >
                <Input placeholder={intl.formatMessage({ id: 'taskTemplate.searchScopePlaceholder' })} />
              </Form.Item>
            ) : (
              <Form.Item
                className={styles.methodConfigField}
                label={intl.formatMessage({ id: 'taskTemplate.sourceKnowledge' })}
                name="sourceKnowledge"
                rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectSourceKnowledge' }) }]}
              >
                <Select options={availableKnowledgeOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            )}
          </div>
          <div className={styles.storageMethodRow}>
            <div className={styles.methodField}>
              <strong>{intl.formatMessage({ id: 'taskTemplate.storageMode' })}</strong>
              <Form.Item name="storageMode">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="knowledge">
                    {intl.formatMessage({ id: 'projectSpace.resources.knowledge' })}
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>
            <Form.Item
              className={styles.methodConfigField}
              label={intl.formatMessage({ id: 'ui.task.targetKnowledge' })}
              name="targetKnowledge"
              rules={[{ required: true, message: intl.formatMessage({ id: 'ui.task.selectKnowledge' }) }]}
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
          <Form.Item
            label={intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.contentType' })}
            name="contentType"
          >
            <Select
              options={['公众号文章', '小红书图文', '短视频脚本'].map((value) => ({
                label: taskTemplateOptionLabel(value),
                value,
              }))}
            />
          </Form.Item>
          <Form.Item label={intl.formatMessage({ id: 'taskTemplate.audience' })} name="audience">
            <Input />
          </Form.Item>
        </div>
      );
    }
    if (selectedTemplate.templateType === 'publish') {
      return (
        <div className={styles.formGrid}>
          <Form.Item label={intl.formatMessage({ id: 'taskTemplate.platform' })} name="platform">
            <Select
              options={['微信公众号', '小红书', '微信视频号', '抖音'].map((value) => ({
                label: taskTemplateOptionLabel(value),
                value,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishAccount' })}
            name="account"
          >
            <Select options={availableAccountOptions} showSearch optionFilterProp="label" />
          </Form.Item>
        </div>
      );
    }
    return (
      <div className={styles.formGrid}>
        <Form.Item label={intl.formatMessage({ id: 'taskTemplate.analysisScope' })} name="analysisScope">
          <Select
            options={['账号整体分析', '指定作品分析'].map((value) => ({
              label: taskTemplateOptionLabel(value),
              value,
            }))}
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'taskTemplate.timeRange' })} name="range">
          <Select
            options={['近 7 天', '近 30 天', '本季度'].map((value) => ({
              label: taskTemplateOptionLabel(value),
              value,
            }))}
          />
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
              {intl.formatMessage({ id: 'taskTemplate.back' })}
            </Button>,
            <Button
              key="apply"
              type="primary"
              loading={applying || applyingTemplate}
              onClick={() => void applyTemplate()}
            >
              {applyText ?? intl.formatMessage({ id: 'taskTemplate.apply' })}
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
              label={intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.taskName' })}
              name="title"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: intl.formatMessage({ id: 'projectSpace.operation.taskForm.validation.taskNameRequired' }),
                },
              ]}
            >
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item
              label={
                selectedTemplate.templateType === 'collect'
                  ? intl.formatMessage({ id: 'taskTemplate.collectionDescription' })
                  : intl.formatMessage({ id: 'taskTemplate.requirements' })
              }
              name="description"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: intl.formatMessage({ id: 'taskTemplate.enterRequirements' }),
                },
              ]}
            >
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
            {renderTypeFields()}
            <section className={styles.executionSection}>
              <strong>{intl.formatMessage({ id: 'projectSpace.requirements.executionConfig' })}</strong>
              <div className={styles.executionGrid}>
                <Form.Item
                  label={intl.formatMessage({ id: 'taskTemplate.executor' })}
                  name="executorType"
                  rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectExecutor' }) }]}
                >
                  <Select
                    options={[
                      { label: intl.formatMessage({ id: 'projectTaskDetail.simple.agent' }), value: 'agent' },
                      {
                        label: intl.formatMessage({ id: 'taskTemplate.groupUnavailable' }),
                        value: 'group',
                        disabled: !availableGroupOptions.length,
                      },
                    ]}
                  />
                </Form.Item>
                {executorType === 'group' ? (
                  <Form.Item
                    label={intl.formatMessage({ id: 'taskTemplate.selectGroupLabel' })}
                    name="agentGroupId"
                    rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectGroup' }) }]}
                  >
                    <Select
                      options={availableGroupOptions}
                      notFoundContent={intl.formatMessage({ id: 'taskTemplate.noGroups' })}
                    />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label={intl.formatMessage({ id: 'projectSpace.operation.execute.agentLabel' })}
                    name="agentId"
                    rules={[
                      {
                        required: true,
                        message: intl.formatMessage({ id: 'projectSpace.resources.employeePlaceholder' }),
                      },
                    ]}
                  >
                    <Select options={fallbackAgentOptions} showSearch optionFilterProp="label" />
                  </Form.Item>
                )}
                <Form.Item
                  className={styles.executionModeField}
                  label={intl.formatMessage({ id: 'projectSpace.detail.integration.run.mode' })}
                  name="runMode"
                  rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectRunMode' }) }]}
                >
                  <Select
                    options={[
                      { label: intl.formatMessage({ id: 'taskTemplate.run.once' }), value: 'once' },
                      { label: intl.formatMessage({ id: 'taskTemplate.run.periodic' }), value: 'periodic' },
                      { label: intl.formatMessage({ id: 'taskTemplate.run.interval' }), value: 'interval' },
                    ]}
                  />
                </Form.Item>
                {runMode === 'once' && (
                  <Form.Item
                    label={intl.formatMessage({ id: 'taskTemplate.runTime' })}
                    name="onceTime"
                    rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.selectRunTime' }) }]}
                  >
                    <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                )}
                {runMode === 'periodic' && (
                  <>
                    <Form.Item
                      label={intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectPeriodType' })}
                      name="periodType"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'projectSpace.operation.taskForm.validation.collectPeriodTypeRequired',
                          }),
                        },
                      ]}
                    >
                      <Select
                        options={[
                          {
                            label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.daily' }),
                            value: 'daily',
                          },
                          {
                            label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.weekly' }),
                            value: 'weekly',
                          },
                          {
                            label: intl.formatMessage({
                              id: 'projectSpace.operation.taskForm.collect.period.biweekly',
                            }),
                            value: 'biweekly',
                          },
                          {
                            label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.monthly' }),
                            value: 'monthly',
                          },
                          {
                            label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.yearly' }),
                            value: 'yearly',
                          },
                        ]}
                      />
                    </Form.Item>
                    {periodType === 'yearly' ? (
                      <Form.Item
                        label={intl.formatMessage({ id: 'taskTemplate.monthDayTime' })}
                        name="periodYearDateTime"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'taskTemplate.selectMonthDayTime' }) },
                        ]}
                      >
                        <DatePicker showTime={{ format: 'HH:mm' }} format="MM-DD HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    ) : (
                      <Form.Item
                        label={intl.formatMessage({ id: 'taskTemplate.timeOfDay' })}
                        name="periodTime"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'taskTemplate.selectTimeOfDay' }) },
                        ]}
                      >
                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    )}
                    {(periodType === 'weekly' || periodType === 'biweekly') && (
                      <Form.Item
                        label={intl.formatMessage({ id: 'taskTemplate.runDays' })}
                        name="periodWeekdays"
                        rules={[
                          {
                            required: true,
                            type: 'array',
                            min: 1,
                            message: intl.formatMessage({ id: 'taskTemplate.selectRunDays' }),
                          },
                        ]}
                      >
                        <Select mode="multiple" options={getWeekdayOptions()} />
                      </Form.Item>
                    )}
                    {periodType === 'monthly' && (
                      <Form.Item
                        label={intl.formatMessage({ id: 'taskTemplate.runDates' })}
                        name="periodMonthDays"
                        rules={[
                          {
                            required: true,
                            type: 'array',
                            min: 1,
                            message: intl.formatMessage({ id: 'taskTemplate.selectRunDates' }),
                          },
                        ]}
                      >
                        <Select mode="multiple" options={getMonthDayOptions()} />
                      </Form.Item>
                    )}
                    <Form.Item
                      label={intl.formatMessage({
                        id: 'projectSpace.operation.taskForm.field.collectEffectiveDateRange',
                      })}
                      name="effectiveDateRange"
                    >
                      <DatePicker.RangePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                )}
                {runMode === 'interval' && (
                  <>
                    <Form.Item
                      label={intl.formatMessage({ id: 'taskTemplate.everyHours' })}
                      name="intervalHours"
                      rules={[{ required: true, message: intl.formatMessage({ id: 'taskTemplate.enterInterval' }) }]}
                    >
                      <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      label={intl.formatMessage({ id: 'taskTemplate.runDays' })}
                      name="intervalWeekdays"
                      rules={[
                        {
                          required: true,
                          type: 'array',
                          min: 1,
                          message: intl.formatMessage({ id: 'taskTemplate.selectRunDays' }),
                        },
                      ]}
                    >
                      <Select mode="multiple" options={getWeekdayOptions()} />
                    </Form.Item>
                    <Form.Item
                      label={intl.formatMessage({
                        id: 'projectSpace.operation.taskForm.field.collectEffectiveDateRange',
                      })}
                      name="effectiveDateRange"
                    >
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
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'taskTemplate.empty' })} />
        ) : null}
      </Spin>
    </Modal>
  );
};

export default TaskTemplateModal;
