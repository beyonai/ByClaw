import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Radio, Select, Spin, TimePicker, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  getOperationTaskTemplate,
  listOperationTaskTemplates,
  queryObjectsByKnowledge,
  type OperationTaskTemplate,
  type OperationTaskTemplateType,
} from '@/service/devloop';
import { queryAuthDoc } from '@/service/knowledgeCenter';
import { ResourceTypeMap } from '@/constants/resource';
import styles from './index.module.less';

export type OntologyObjectValue = {
  id?: string | number;
  objectId?: string | number;
  resourceId?: string | number;
  objectCode?: string;
  resourceCode?: string;
  code?: string;
  objectName?: string;
  resourceName?: string;
  name?: string;
  objectDesc?: string;
  resourceDesc?: string;
  description?: string;
  objectSource?: string;
  fieldCount?: number;
  actionCount?: number;
  ownerType?: string;
  userCode?: string | null;
  baseId?: string;
  kbResourceId?: string;
  kbDirectory?: string;
  [key: string]: unknown;
};

export type TaskTemplateFormValues = {
  title: string;
  description: string;
  sourceMode?: 'knowledge' | 'connector' | 'internet';
  sourceKnowledge?: string | number;
  connector?: string | number;
  internetScope?: string;
  storageMode?: 'knowledge' | 'ontology';
  targetKnowledge?: string | number;

  /** 选中的本体对象列表；提交给后端时为完整对象数组，表单内 Select 使用 objectCode/objectName 作为多选 value */
  ontology?: Array<string | number | OntologyObjectValue>;
  materialSource?: string | number;
  /** 素材来源为本体数据时选中的来源本体，与整理后的目标本体分开保存。 */
  sourceOntology?: Array<string | number | OntologyObjectValue>;
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

  /** 本体对象完整信息，提交 execute 时回传给后端 */
  raw?: OntologyObjectValue;
};

export interface TaskTemplateModalProps {
  open: boolean;
  agentOptions?: Array<{ label: string; value: string | number }>;
  /** 项目任务场景只允许选择项目绑定数字员工，不回退“当前数字员工”。 */
  agentOptionsOnly?: boolean;
  agentGroupOptions?: Array<{ label: string; value: string | number }>;
  initialTemplateType?: OperationTaskTemplateType;
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
  ontologyOptions?: TaskTemplateOption[];
  /** 项目任务场景只允许使用项目绑定本体，禁止按知识库查询其它本体对象。 */
  ontologyOptionsOnly?: boolean;
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
  knowledge: {
    title: '整理采集素材并沉淀知识',
    description: '对素材去重、摘要并提炼文章亮点、写法和可复用结构。',
    materialSource: '本体数据',
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

const getOntologySelectValues = (ontology: TaskTemplateFormValues['ontology']): Array<string | number> => {
  if (ontology === undefined || ontology === null) return [];
  const list = Array.isArray(ontology) ? ontology : [ontology];
  return list
    .map((item) => {
      if (item && typeof item === 'object') {
        return (item.objectCode || item.objectName) as string | undefined;
      }
      return item;
    })
    .filter((item): item is string | number => item !== undefined && item !== null && `${item}` !== '');
};

const normalizeOntologyObjectValue = (
  option: TaskTemplateOption | undefined,
  fallbackValue: string | number
): OntologyObjectValue => {
  const raw = option?.raw || {};
  const id = raw.objectId ?? raw.resourceId ?? raw.id ?? raw.baseId ?? fallbackValue;
  const code = raw.objectCode || raw.resourceCode || raw.code || `${fallbackValue}`;
  const name = raw.objectName || raw.resourceName || raw.name || option?.label || `${fallbackValue}`;
  const description = raw.objectDesc || raw.resourceDesc || raw.description || '';
  // 同时保留本体、资源和通用字段别名，兼容后端任务执行、对象详情及 Worker 的不同取值口径。
  return {
    ...raw,
    id,
    objectId: raw.objectId ?? id,
    resourceId: raw.resourceId ?? id,
    baseId: raw.baseId || `${id}`,
    code,
    objectCode: raw.objectCode || code,
    resourceCode: raw.resourceCode || code,
    name,
    objectName: raw.objectName || name,
    resourceName: raw.resourceName || name,
    description,
    objectDesc: raw.objectDesc || description,
    resourceDesc: raw.resourceDesc || description,
  };
};

const resolveInitialOptionValue = (
  options: TaskTemplateOption[],
  currentValue: string | number | undefined
): string | number | undefined => {
  if (currentValue === undefined || currentValue === null) return undefined;
  if (!options.length || options.some((option) => `${option.value}` === `${currentValue}`)) return currentValue;
  return options[0].value;
};

const resolveInitialOntologyValues = (
  options: TaskTemplateOption[],
  currentValue: TaskTemplateFormValues['ontology']
): Array<string | number> | undefined => {
  const values = (Array.isArray(currentValue) ? currentValue : [currentValue])
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => {
      if (item && typeof item === 'object') return item.objectCode || item.objectName;
      return item;
    })
    .filter((item): item is string | number => item !== undefined && item !== null && `${item}`.trim() !== '');
  if (!options.length) return undefined;
  const matchedValues = values
    .map((value) =>
      options.find(
        (option) => `${option.value}` === `${value}`.trim() || `${option.label}` === `${value}`.trim()
      )
    )
    .filter((option): option is TaskTemplateOption => !!option)
    .map((option) => option.value);
  return matchedValues.length ? matchedValues : [options[0].value];
};

const parseTemplateConfig = (template: OperationTaskTemplate): TaskTemplateFormValues => {
  try {
    const rawConfig =
      typeof template.config === 'string'
        ? JSON.parse(template.config)
        : template.config && typeof template.config === 'object'
          ? template.config
          : {};
    const merged = { ...(DEFAULT_CONFIG[template.templateType] || DEFAULT_CONFIG.collect), ...rawConfig };
    // 兼容历史单选 ontology，统一转成数组便于多选回显。
    if (merged.ontology !== undefined && merged.ontology !== null && !Array.isArray(merged.ontology)) {
      merged.ontology = [merged.ontology];
    }
    return merged;
  } catch {
    return DEFAULT_CONFIG[template.templateType] || DEFAULT_CONFIG.collect;
  }
};

const findOptionLabel = (
  options: TaskTemplateOption[],
  value: string | number | OntologyObjectValue | Array<string | number | OntologyObjectValue> | undefined,
  fallback = '-'
) => {
  if (Array.isArray(value)) {
    const labels = getOntologySelectValues(value)
      .map((item) => findOptionLabel(options, item, ''))
      .filter(Boolean);
    return labels.length ? labels.join('、') : fallback;
  }
  if (value && typeof value === 'object') {
    return value.objectName || value.objectCode || fallback;
  }
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
    ontologies: TaskTemplateOption[];
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
    const target =
      values.storageMode === 'ontology'
        ? `本体：${findOptionLabel(options.ontologies, values.ontology)}`
        : `知识库：${findOptionLabel(options.knowledgeBases, values.targetKnowledge)}`;
    detailLines.push(`采集方式：${sourceModeLabel}`, `采集来源：${sourceLabel}`, `入库位置：${target}`);
  } else if (template.templateType === 'knowledge') {
    detailLines.push(
      `素材来源：${values.materialSource || '-'}`,
      ...(values.materialSource === '本体数据'
        ? [`来源本体：${findOptionLabel(options.ontologies, values.sourceOntology)}`]
        : []),
      `目标本体：${findOptionLabel(options.ontologies, values.ontology)}`
    );
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
  initialTitle,
  onCancel,
  onApply,
  applyText = '确定应用到对话框',
  applying = false,
  initialDescription,
  knowledgeOptions = [],
  knowledgeOptionsOnly = false,
  ontologyOptions = [],
  ontologyOptionsOnly = false,
  accountOptions = [],
}) => {
  const [form] = Form.useForm<TaskTemplateFormValues>();
  const [templates, setTemplates] = useState<OperationTaskTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<OperationTaskTemplate>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [fetchedKnowledgeOptions, setFetchedKnowledgeOptions] = useState<TaskTemplateOption[]>([]);
  const [fetchedOntologyOptions, setFetchedOntologyOptions] = useState<TaskTemplateOption[]>([]);
  const sourceMode = Form.useWatch('sourceMode', form);
  const connector = Form.useWatch('connector', form);
  const sourceKnowledge = Form.useWatch('sourceKnowledge', form);
  const targetKnowledge = Form.useWatch('targetKnowledge', form);
  const storageMode = Form.useWatch('storageMode', form);
  const materialSource = Form.useWatch('materialSource', form);
  const executorType = Form.useWatch('executorType', form);
  const runMode = Form.useWatch('runMode', form);
  const periodType = Form.useWatch('periodType', form);

  useEffect(() => {
    // 切换到连接器采集后，若模板没有保存连接器，则默认选择第一个可用连接器。
    if (selectedTemplate?.templateType !== 'collect' || sourceMode !== 'connector' || connector) return;
    form.setFieldValue('connector', CONNECTOR_OPTIONS[0]?.value);
  }, [connector, form, selectedTemplate, sourceMode]);

  useEffect(() => {
    if (ontologyOptionsOnly) {
      setFetchedOntologyOptions([]);
      return;
    }
    if (!selectedTemplate || selectedTemplate.templateType !== 'collect' || storageMode !== 'ontology') {
      setFetchedOntologyOptions([]);
      return;
    }
    const kbResourceId = sourceKnowledge || targetKnowledge;
    if (!kbResourceId) {
      setFetchedOntologyOptions([]);
      form.setFieldValue('ontology', []);
      return;
    }
    void queryObjectsByKnowledge({ kbResourceId, pageIndex: 1, pageSize: 100 })
      .then((response: any) => {
        // 兼容本体对象接口的数组、分页 data.items 及历史 data.data.items 返回结构。
        const rows = Array.isArray(response)
          ? response
          : response?.items ||
            response?.rows ||
            response?.list ||
            response?.data?.items ||
            response?.data?.rows ||
            response?.data?.list ||
            response?.data?.data?.items ||
            [];
        const options = rows
          .map((item: any) => {
            const value = item.objectCode || item.objectName;
            const label = item.objectName || item.objectCode;
            if (!value || !label) return null;
            return {
              value,
              label,
              raw: item as OntologyObjectValue,
            };
          })
          .filter(Boolean) as TaskTemplateOption[];
        setFetchedOntologyOptions(options);
        // 接口无数据时不展示写死选项，并清空已选本体。
        if (!options.length) {
          form.setFieldValue('ontology', []);
        }
      })
      .catch(() => {
        setFetchedOntologyOptions([]);
        form.setFieldValue('ontology', []);
      });
  }, [form, ontologyOptionsOnly, selectedTemplate, sourceKnowledge, storageMode, targetKnowledge]);

  useEffect(() => {
    if (!open) return;
    setSelectedTemplate(undefined);
    setApplyingTemplate(false);
    form.resetFields();
    setLoading(true);
    void listOperationTaskTemplates(initialTemplateType)
      .then((response) => {
        const rows = Array.isArray(response) ? response : [];
        setTemplates(rows);
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
      const resolvedTemplate = detail || template;
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
      const resolvedOntologyOptions = ontologyOptionsOnly
        ? ontologyOptions
        : ontologyOptions.length
          ? ontologyOptions
          : fetchedOntologyOptions;
      const resolvedAccountOptions = accountOptions.length ? accountOptions : DEFAULT_ACCOUNT_OPTIONS;
      setSelectedTemplate(resolvedTemplate);
      form.setFieldsValue({
        ...templateValues,
        // 采集类模板每次打开均默认选择界面中的第一个采集方式和入库方式。
        ...(resolvedTemplate.templateType === 'collect'
          ? {
              sourceMode: 'connector' as const,
              storageMode: 'ontology' as const,
            }
          : {}),
        // 知识整理类模板打开时统一默认选中素材来源第一项“本体数据”。
        ...(resolvedTemplate.templateType === 'knowledge' ? { materialSource: '本体数据' } : {}),
        ...(initialTitle ? { title: initialTitle } : {}),
        ...(initialDescription ? { description: initialDescription } : {}),
        sourceKnowledge: resolveInitialOptionValue(resolvedKnowledgeOptions, templateValues.sourceKnowledge),
        targetKnowledge: resolveInitialOptionValue(resolvedKnowledgeOptions, templateValues.targetKnowledge),
        // 知识整理模板沿用 sourceMode/storageMode 保存来源本体和目标本体名称，打开时转换为 Select 值。
        sourceOntology: resolveInitialOntologyValues(
          resolvedOntologyOptions,
          resolvedTemplate.templateType === 'knowledge'
            ? templateValues.sourceOntology || (templateValues.sourceMode as TaskTemplateFormValues['ontology'])
            : templateValues.sourceOntology
        ),
        ontology: resolveInitialOntologyValues(
          resolvedOntologyOptions,
          resolvedTemplate.templateType === 'knowledge'
            ? templateValues.ontology || (templateValues.storageMode as TaskTemplateFormValues['ontology'])
            : templateValues.ontology
        ),
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

  const title = selectedTemplate ? selectedTemplate.templateName : '选择任务模板';
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
  const availableOntologyOptions = useMemo(
    () =>
      ontologyOptionsOnly
        ? ontologyOptions
        : ontologyOptions.length
          ? ontologyOptions
          : fetchedOntologyOptions,
    [fetchedOntologyOptions, ontologyOptions, ontologyOptionsOnly]
  );
  const availableAccountOptions = useMemo(
    () => (accountOptions.length ? accountOptions : DEFAULT_ACCOUNT_OPTIONS),
    [accountOptions]
  );

  useEffect(() => {
    const shouldDefaultOntology =
      selectedTemplate?.templateType === 'knowledge' ||
      (selectedTemplate?.templateType === 'collect' && storageMode === 'ontology');
    if (!shouldDefaultOntology || !availableOntologyOptions.length) return;
    const currentValue = form.getFieldValue('ontology');
    if (currentValue !== undefined && currentValue !== null) return;
    // 本体列表晚于模板详情返回时，优先按模板 storageMode 回显目标本体，不能直接覆盖为第一项。
    const configuredTarget =
      selectedTemplate?.templateType === 'knowledge'
        ? (form.getFieldValue('storageMode') as TaskTemplateFormValues['ontology'])
        : undefined;
    form.setFieldValue(
      'ontology',
      resolveInitialOntologyValues(availableOntologyOptions, configuredTarget) || [availableOntologyOptions[0].value]
    );
  }, [availableOntologyOptions, form, selectedTemplate, storageMode]);

  useEffect(() => {
    if (selectedTemplate?.templateType !== 'knowledge') return;
    const currentValue = form.getFieldValue('sourceOntology');
    if (materialSource !== '本体数据') {
      // 切换为其它素材来源时清理隐藏字段，避免提交与当前选择无关的本体配置。
      if (currentValue !== undefined) form.setFieldValue('sourceOntology', undefined);
      return;
    }
    if (currentValue !== undefined || !availableOntologyOptions.length) return;
    // 来源本体以模板 sourceMode 为准，例如“会议纪要”；仅未配置或匹配不到时才回退第一项。
    const configuredSource = form.getFieldValue('sourceMode') as TaskTemplateFormValues['ontology'];
    form.setFieldValue(
      'sourceOntology',
      resolveInitialOntologyValues(availableOntologyOptions, configuredSource) || [availableOntologyOptions[0].value]
    );
  }, [availableOntologyOptions, form, materialSource, selectedTemplate]);

  const applyTemplate = async () => {
    if (!selectedTemplate) return;
    setApplyingTemplate(true);
    try {
      const values = await form.validateFields();
      // 表单 Select 存的是编码/名称，提交给后端时改为完整本体对象数组。
      const submitValues: TaskTemplateFormValues = {
        ...values,
        sourceOntology:
          values.materialSource === '本体数据'
            ? getOntologySelectValues(values.sourceOntology).map((value) => {
                const ontologyOption = availableOntologyOptions.find(
                  (option) => `${option.value}` === `${value}`
                );
                return normalizeOntologyObjectValue(ontologyOption, value);
              })
            : undefined,
        ontology: getOntologySelectValues(values.ontology).map((value) => {
          const ontologyOption = availableOntologyOptions.find((option) => `${option.value}` === `${value}`);
          return normalizeOntologyObjectValue(ontologyOption, value);
        }),
      };
      if (selectedTemplate.templateType === 'knowledge') {
        // 后端知识整理配置继续使用 sourceMode/storageMode，值为本体名称，兼容既有任务执行协议。
        Object.assign(submitValues, {
          sourceMode:
            values.materialSource === '本体数据'
              ? findOptionLabel(availableOntologyOptions, values.sourceOntology, '').replace(/、/g, ',')
              : undefined,
          storageMode: findOptionLabel(availableOntologyOptions, values.ontology, '').replace(/、/g, ','),
        });
      }
      const prompt = buildTemplatePrompt(selectedTemplate, values, {
        agents: fallbackAgentOptions,
        groups: availableGroupOptions,
        knowledgeBases: availableKnowledgeOptions,
        ontologies: availableOntologyOptions,
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
                  <Radio.Button value="ontology">本体</Radio.Button>
                  <Radio.Button value="knowledge">知识库</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>
            {storageMode === 'ontology' ? (
              <Form.Item
                className={styles.methodConfigField}
                label="本体"
                name="ontology"
                rules={[{ required: true, type: 'array', min: 1, message: '请选择目标本体' }]}
              >
                <Select
                  mode="multiple"
                  options={availableOntologyOptions}
                  showSearch
                  optionFilterProp="label"
                  placeholder="可多选本体对象"
                />
              </Form.Item>
            ) : (
              <Form.Item
                className={styles.methodConfigField}
                label="目标知识库"
                name="targetKnowledge"
                rules={[{ required: true, message: '请选择目标知识库' }]}
              >
                <Select options={availableKnowledgeOptions} showSearch optionFilterProp="label" />
              </Form.Item>
            )}
          </div>
        </>
      );
    }
    if (selectedTemplate.templateType === 'knowledge') {
      return (
        <div className={styles.formGrid}>
          <Form.Item label="素材来源" name="materialSource">
            <Select
              options={['本体数据', '当前会话成果', '项目共享文件', '指定知识库目录'].map((value) => ({
                label: value,
                value,
              }))}
            />
          </Form.Item>
          {materialSource === '本体数据' && (
            <Form.Item
              label="来源本体"
              name="sourceOntology"
              rules={[{ required: true, type: 'array', min: 1, message: '请选择来源本体' }]}
            >
              <Select
                mode="multiple"
                options={availableOntologyOptions}
                showSearch
                optionFilterProp="label"
                placeholder="可多选来源本体"
              />
            </Form.Item>
          )}
          <Form.Item label="目标本体" name="ontology">
            <Select
              mode="multiple"
              options={availableOntologyOptions}
              showSearch
              optionFilterProp="label"
              placeholder="可多选本体对象"
            />
          </Form.Item>
        </div>
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
                    <Form.Item label="周期类型" name="periodType" rules={[{ required: true, message: '请选择周期类型' }]}>
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
                      <Form.Item label="月日时分" name="periodYearDateTime" rules={[{ required: true, message: '请选择月日时分' }]}>
                        <DatePicker showTime={{ format: 'HH:mm' }} format="MM-DD HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    ) : (
                      <Form.Item label="执行时分" name="periodTime" rules={[{ required: true, message: '请选择执行时分' }]}>
                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                      </Form.Item>
                    )}
                    {(periodType === 'weekly' || periodType === 'biweekly') && (
                      <Form.Item label="执行日" name="periodWeekdays" rules={[{ required: true, type: 'array', min: 1, message: '请选择执行日' }]}>
                        <Select mode="multiple" options={WEEKDAY_OPTIONS} />
                      </Form.Item>
                    )}
                    {periodType === 'monthly' && (
                      <Form.Item label="执行日期" name="periodMonthDays" rules={[{ required: true, type: 'array', min: 1, message: '请选择执行日期' }]}>
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
                    <Form.Item label="每几小时" name="intervalHours" rules={[{ required: true, message: '请输入间隔小时数' }]}>
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
                <i>{template.icon || template.templateName.slice(0, 1)}</i>
                <span>
                  <strong>{template.templateName}</strong>
                  <small>{template.description}</small>
                </span>
                <RightOutlined />
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
