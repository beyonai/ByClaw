import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Switch, TimePicker, message } from 'antd';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import type {
  OperationAccount,
  OperationCollectConfig,
  OperationIdentifier,
  OperationPlatformOption,
  OperationSelectOption,
  OperationTaskFormOptions,
  OperationTaskFormValues,
} from './types';
import styles from './index.module.less';

// 四类运营需求复用此弹窗；父组件负责提供项目成员、账号和知识库等动态选项。
export interface OperationTaskFormModalProps {
  open: boolean;
  mode?: 'create' | 'edit';
  // 同一套四类配置表单可用于运营需求或历史运营任务，标题和提交文案按实体区分。
  entityLabel?: 'task' | 'requirement';
  // 原型中的运营需求只录入目标信息；三种执行方式在后续任务模板的执行配置中选择。
  simpleRequirement?: boolean;
  initialValues?: Partial<OperationTaskFormValues>;
  options?: OperationTaskFormOptions;
  loading?: boolean;
  optionLoading?: boolean;
  onCancel: () => void;
  onSubmit: (values: OperationTaskFormValues) => void | Promise<void>;
}

// 选择器的 ID 允许数字或字符串，统一用此方法判断有效值，避免 0 等合法值被误判为空。
const hasIdentifier = (value?: OperationIdentifier) => value !== undefined && value !== null && `${value}` !== '';

// Antd 校验对象含 errorFields，保存异常与校验失败需要分别处理，避免重复提示。
const isFormValidationError = (error: unknown) => typeof error === 'object' && error !== null && 'errorFields' in error;

// 内容类型与平台能力一一对应；新增内容创作需求时按此规则预选发布渠道。
const CONTENT_TYPE_PUBLISH_CHANNEL_MAP: Record<string, string> = {
  'wechat-article': 'WeChatAccount',
  'xiaohongshu-post': 'Xiaohongshu',
  'short-video': 'Douyin',
};

// 周期和间隔采集默认覆盖周一至周日，用户仍可按实际需求取消部分日期。
const ALL_COLLECTION_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

// 年度采集只保存月日时分，使用当前年份承载日期并锁定年份选择范围。
const COLLECTION_DATE_CARRIER_START = dayjs().startOf('year');
const COLLECTION_DATE_CARRIER_END = dayjs().endOf('year');

// 调度表单使用结构化字段，提交时统一转换为五段 Cron，避免让用户直接填写容易出错的表达式。
const buildOperationCollectionCron = (config?: OperationCollectConfig) => {
  if (!config?.mode) return undefined;
  const toSortedValues = (values?: number[]) =>
    Array.from(new Set((values || []).filter((value) => Number.isInteger(value)))).sort((left, right) => left - right);
  const toTimeParts = (value?: OperationCollectConfig['periodTime']) =>
    value?.isValid() ? { hour: value.hour(), minute: value.minute() } : null;

  if (config.mode === 'once') {
    if (!config.onceTime?.isValid()) return undefined;
    return `${config.onceTime.minute()} ${config.onceTime.hour()} ${config.onceTime.date()} ${
      config.onceTime.month() + 1
    } *`;
  }
  if (config.mode === 'interval') {
    const weekdays = toSortedValues(config.intervalWeekdays);
    if (!Number.isInteger(config.intervalHours) || Number(config.intervalHours) < 1 || !weekdays.length)
      return undefined;
    // Cron 的小时步长最多覆盖 0-23；更长间隔由后端结合 last_scan_time 精确判断，Cron 保留每小时候选触发点。
    const hourField = Number(config.intervalHours) <= 23 ? `*/${config.intervalHours}` : '*';
    return `0 ${hourField} * * ${weekdays.join(',')}`;
  }

  if (!config.periodType) return undefined;
  // 年度周期的时分已合并到日期选择器，直接从合并值生成 Cron。
  if (config.periodType === 'yearly' && config.periodYearDateTime?.isValid()) {
    return `${config.periodYearDateTime.minute()} ${config.periodYearDateTime.hour()} ${config.periodYearDateTime.date()} ${
      config.periodYearDateTime.month() + 1
    } *`;
  }
  const time = toTimeParts(config.periodTime);
  if (!time) return undefined;
  if (config.periodType === 'daily') return `${time.minute} ${time.hour} * * *`;
  if (config.periodType === 'weekly' || config.periodType === 'biweekly') {
    const weekdays = toSortedValues(config.periodWeekdays);
    return weekdays.length ? `${time.minute} ${time.hour} * * ${weekdays.join(',')}` : undefined;
  }
  if (config.periodType === 'monthly') {
    const monthDays = toSortedValues(config.periodMonthDays);
    return monthDays.length ? `${time.minute} ${time.hour} ${monthDays.join(',')} * *` : undefined;
  }
  if (!config.periodMonth || !config.periodDay) return undefined;
  return `${time.minute} ${time.hour} ${config.periodDay} ${config.periodMonth} *`;
};

const OperationTaskFormModal: React.FC<OperationTaskFormModalProps> = ({
  open,
  mode = 'create',
  entityLabel = 'task',
  simpleRequirement = false,
  initialValues,
  options = {},
  loading = false,
  optionLoading = false,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<OperationTaskFormValues>();
  const [submitting, setSubmitting] = useState(false);
  // 状态更新前先用同步标记锁住提交入口，避免双击产生两次任务创建请求。
  const submittingRef = useRef(false);
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.operation.taskForm.${id}` }, values),
    [intl]
  );
  const platformT = useCallback(
    (id: string) => intl.formatMessage({ id: `projectSpace.operation.platform.${id}` }),
    [intl]
  );
  const taskType = Form.useWatch('taskType', form) || 'collect';
  const isSimpleRequirement = entityLabel === 'requirement' && simpleRequirement;
  const collectMode = Form.useWatch(['collectConfig', 'mode'], form);
  const collectPeriodType = Form.useWatch(['collectConfig', 'periodType'], form);
  const collectOrganize = Form.useWatch(['collectConfig', 'organize'], form);
  const collectChannel = Form.useWatch(['collectConfig', 'channel'], form);
  const collectKnowledgeBaseId = Form.useWatch(['collectConfig', 'knowledgeBaseId'], form);
  const contentType = Form.useWatch(['contentConfig', 'contentType'], form);
  const publishChannel = Form.useWatch(['contentConfig', 'publishChannel'], form);
  const analysisPlatformId = Form.useWatch(['analyzeConfig', 'platformId'], form);
  const analysisAccountId = Form.useWatch(['analyzeConfig', 'accountId'], form);
  const analysisScope = Form.useWatch(['analyzeConfig', 'scope'], form);

  // 为现有配置类型预置最小可用字段，编辑场景再覆盖同名字段，避免切换类型时嵌套对象丢失。
  const formInitialValues = useMemo<OperationTaskFormValues>(
    () => ({
      taskName: '',
      description: '',
      taskType: 'collect',
      collectConfig: {
        mode: 'once',
        periodType: 'daily',
        periodWeekdays: [...ALL_COLLECTION_WEEKDAYS],
        intervalHours: 1,
        intervalWeekdays: [...ALL_COLLECTION_WEEKDAYS],
        organize: false,
      },
      contentConfig: {},
      analyzeConfig: { scope: 'account' },
      ...initialValues,
      collectConfig: {
        mode: 'once',
        periodType: 'daily',
        periodWeekdays: [...ALL_COLLECTION_WEEKDAYS],
        intervalHours: 1,
        intervalWeekdays: [...ALL_COLLECTION_WEEKDAYS],
        organize: false,
        ...initialValues?.collectConfig,
      },
      contentConfig: { ...initialValues?.contentConfig },
      analyzeConfig: {
        scope: 'account',
        ...initialValues?.analyzeConfig,
      },
    }),
    [initialValues]
  );
  const defaultPlatformOptions = useMemo<OperationPlatformOption[]>(
    () => [
      // 平台值与 OPERATION_CHANNEL 静态参数及运营需求接口保持一致，展示文本仍由国际化键决定。
      { value: 'WeChatAccount', label: platformT('wechat') },
      { value: 'Xiaohongshu', label: platformT('xiaohongshu') },
      { value: 'WeChatChannels', label: platformT('video') },
      { value: 'Douyin', label: platformT('douyin') },
    ],
    [platformT]
  );
  const defaultCollectChannels = useMemo<OperationPlatformOption[]>(
    () => [
      ...defaultPlatformOptions.slice(0, 3),
      { value: 'Internet', label: t('collect.channel.internet') },
      { value: 'GitHub', label: t('collect.channel.github') },
    ],
    [defaultPlatformOptions, t]
  );
  const defaultContentTypes = useMemo<OperationSelectOption<string>[]>(
    () => [
      { value: 'wechat-article', label: t('content.type.wechatArticle') },
      { value: 'xiaohongshu-post', label: t('content.type.xiaohongshuPost') },
      { value: 'short-video', label: t('content.type.shortVideo') },
    ],
    [t]
  );
  const collectChannels = options.collectChannels?.length ? options.collectChannels : defaultCollectChannels;
  const publishChannels = options.publishChannels?.length ? options.publishChannels : defaultPlatformOptions;
  const analysisPlatforms = options.analysisPlatforms?.length ? options.analysisPlatforms : defaultPlatformOptions;
  const contentTypes = options.contentTypes?.length ? options.contentTypes : defaultContentTypes;
  const weekdayOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => ({
        value: index + 1,
        label: t(`collect.weekday.${index + 1}`),
      })),
    [t]
  );
  const monthDayOptions = useMemo(
    () =>
      Array.from({ length: 31 }, (_, index) => ({
        value: index + 1,
        label: t('collect.monthDay', { day: index + 1 }),
      })),
    [t]
  );
  // 只有已接入账号的平台渠道使用账号下拉；互联网、GitHub 等来源继续允许录入地址。
  const isPlatformCollectChannel = defaultPlatformOptions.some((option) => option.value === collectChannel);
  // 内容类型切换后优先使用映射渠道筛选账号，避免等待表单字段更新时短暂展示其它平台账号。
  const publishAccountPlatformId =
    taskType === 'content' && contentType
      ? CONTENT_TYPE_PUBLISH_CHANNEL_MAP[contentType] || publishChannel
      : publishChannel;
  const isSubmitting = loading || submitting;
  const modalTitle = intl.formatMessage({
    id:
      entityLabel === 'requirement'
        ? mode === 'edit'
          ? 'projectSpace.operation.requirement.form.editTitle'
          : 'projectSpace.operation.requirement.form.createTitle'
        : `projectSpace.operation.taskForm.${mode === 'edit' ? 'editTitle' : 'createTitle'}`,
  });
  const submitText = intl.formatMessage({
    id:
      entityLabel === 'requirement'
        ? mode === 'edit'
          ? 'projectSpace.operation.requirement.form.save'
          : 'projectSpace.operation.requirement.form.create'
        : `projectSpace.operation.taskForm.${mode === 'edit' ? 'save' : 'create'}`,
  });
  const entityT = useCallback(
    (id: string) =>
      intl.formatMessage({
        id:
          entityLabel === 'requirement'
            ? `projectSpace.operation.requirement.form.${id}`
            : `projectSpace.operation.taskForm.${id}`,
      }),
    [entityLabel, intl]
  );

  // 发布和分析共用账号池，但必须按当前平台过滤，避免跨平台账号被提交到任务配置。
  const getAccountOptions = useCallback(
    (accounts: OperationAccount[] = [], platformId?: string) =>
      accounts
        .filter((account) => !platformId || account.platformId === platformId)
        .map((account) => ({
          // 运营需求配置需保存平台侧账号编码，而非本系统账号主键，后续执行服务可直接使用。
          value: account.accountId,
          label: t('accountOption', { name: account.accountName, id: account.accountId }),
        })),
    [t]
  );
  const publishAccountOptions = useMemo(
    () => getAccountOptions(options.accounts, publishAccountPlatformId),
    [getAccountOptions, options.accounts, publishAccountPlatformId]
  );
  const collectAccountOptions = useMemo(
    () => getAccountOptions(options.accounts, collectChannel),
    [collectChannel, getAccountOptions, options.accounts]
  );
  const analysisAccountOptions = useMemo(
    () => getAccountOptions(options.accounts, analysisPlatformId),
    [analysisPlatformId, getAccountOptions, options.accounts]
  );
  const directoryOptions = useMemo(
    () =>
      (options.directories || []).filter(
        (directory) =>
          !hasIdentifier(directory.knowledgeBaseId) ||
          !hasIdentifier(collectKnowledgeBaseId) ||
          `${directory.knowledgeBaseId}` === `${collectKnowledgeBaseId}`
      ),
    [collectKnowledgeBaseId, options.directories]
  );
  const analysisWorkOptions = useMemo(
    () =>
      (options.works || []).filter(
        (work) =>
          !hasIdentifier(work.accountId) ||
          !hasIdentifier(analysisAccountId) ||
          `${work.accountId}` === `${analysisAccountId}`
      ),
    [analysisAccountId, options.works]
  );
  useEffect(() => {
    if (!open) return;
    // 重新打开时以最新初始值回填，防止关闭弹窗后保留上一份任务草稿。
    form.resetFields();
    form.setFieldsValue(formInitialValues);
  }, [form, formInitialValues, open]);

  useEffect(() => {
    if (!open || mode !== 'create' || taskType !== 'collect' || !collectChannels.length) return;
    const selectedChannel = form.getFieldValue(['collectConfig', 'channel']);
    if (!hasIdentifier(selectedChannel)) {
      // 新增采集需求默认选择首个可用渠道；编辑态和用户已选择的渠道均不覆盖。
      form.setFieldValue(['collectConfig', 'channel'], collectChannels[0].value);
    }
  }, [collectChannels, form, mode, open, taskType]);

  useEffect(() => {
    if (
      !open ||
      mode !== 'create' ||
      taskType !== 'collect' ||
      !isPlatformCollectChannel ||
      !collectAccountOptions.length
    ) {
      return;
    }
    const selectedAccountId = form.getFieldValue(['collectConfig', 'accountOrAddress']);
    const selectedAccount = options.accounts?.find((account) => `${account.accountId}` === `${selectedAccountId}`);
    if (!selectedAccount || selectedAccount.platformId !== collectChannel) {
      // 采集渠道切换后默认选中该平台首个账号，避免把上一个渠道的账号提交给当前采集任务。
      form.setFieldValue(['collectConfig', 'accountOrAddress'], collectAccountOptions[0].value);
    }
  }, [collectAccountOptions, collectChannel, form, isPlatformCollectChannel, mode, open, options.accounts, taskType]);

  useEffect(() => {
    if (!open || mode !== 'create' || taskType !== 'content' || !contentType) return;
    const matchedChannel = CONTENT_TYPE_PUBLISH_CHANNEL_MAP[contentType];
    if (matchedChannel) {
      // 内容类型变更时覆盖发布渠道，保证公众号文章、小红书图文和短视频对应正确的平台。
      form.setFieldValue(['contentConfig', 'publishChannel'], matchedChannel);
    }
  }, [contentType, form, mode, open, taskType]);

  useEffect(() => {
    if (!open || !publishAccountPlatformId || !options.accounts?.length) return;
    const selectedAccountId = form.getFieldValue(['contentConfig', 'publishAccountId']);
    const selectedAccount = options.accounts.find((account) => `${account.accountId}` === `${selectedAccountId}`);
    if (selectedAccount && selectedAccount.platformId !== publishAccountPlatformId) {
      // 发布渠道一次只允许选择一个，切换渠道后清理原渠道账号，
      // 避免提交不一致的渠道和账号组合。
      form.setFieldValue(['contentConfig', 'publishAccountId'], undefined);
    }
  }, [form, open, options.accounts, publishAccountPlatformId]);

  useEffect(() => {
    if (!open || taskType !== 'analyze' || !analysisPlatformId) return;
    const selectedAccountId = form.getFieldValue(['analyzeConfig', 'accountId']);
    const selectedAccount = analysisAccountOptions.find((account) => `${account.value}` === `${selectedAccountId}`);
    if (!selectedAccount) {
      // 数据分析渠道切换后默认选中该渠道首个账号，并清理前一账号下的作品，避免提交跨渠道配置。
      form.setFieldsValue({
        analyzeConfig: {
          ...form.getFieldValue('analyzeConfig'),
          accountId: analysisAccountOptions[0]?.value,
          workIds: [],
        },
      });
    }
  }, [analysisAccountOptions, analysisPlatformId, form, open, taskType]);

  useEffect(() => {
    if (!open || !hasIdentifier(analysisAccountId)) return;
    const selectedWorkIds = form.getFieldValue(['analyzeConfig', 'workIds']) || [];
    const availableWorkIdSet = new Set(analysisWorkOptions.map((work) => String(work.value)));
    const nextWorkIds = selectedWorkIds.filter((workId) => availableWorkIdSet.has(String(workId)));
    if (nextWorkIds.length !== selectedWorkIds.length) {
      // 账号变化后仅保留属于当前账号的作品，避免跨账号分析。
      form.setFieldValue(['analyzeConfig', 'workIds'], nextWorkIds);
    }
  }, [analysisAccountId, analysisWorkOptions, form, open]);

  useEffect(() => {
    if (!open || !hasIdentifier(collectKnowledgeBaseId)) return;
    const selectedDirectoryId = form.getFieldValue(['collectConfig', 'directoryId']);
    if (!hasIdentifier(selectedDirectoryId)) return;
    const selectedDirectory = (options.directories || []).find(
      (directory) => `${directory.value}` === `${selectedDirectoryId}`
    );
    if (
      selectedDirectory &&
      hasIdentifier(selectedDirectory.knowledgeBaseId) &&
      `${selectedDirectory.knowledgeBaseId}` !== `${collectKnowledgeBaseId}`
    ) {
      // 知识库切换后清理不属于当前知识库的目录，防止归档位置失配。
      form.setFieldValue(['collectConfig', 'directoryId'], undefined);
    }
  }, [collectKnowledgeBaseId, form, open, options.directories]);

  const handleSubmit = useCallback(async () => {
    if (loading || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      if (
        values.taskType === 'collect' &&
        values.collectConfig?.organize &&
        !values.collectConfig.knowledgeOrganization
      ) {
        // 开启整理但未选择本地本体时不允许提交，避免后端收到无法执行的空整理配置。
        message.error(t('validation.organizeTemplateRequired'));
        return;
      }
      // 只提交当前任务类型的业务配置，避免表单切换后把其它类型的残留字段带给后端。
      const collectConfig =
        values.taskType === 'collect'
          ? {
            ...(isSimpleRequirement
              ? {
                // 简化需求只保存执行方式和调度字段，渠道、账号、主题等信息在任务模板阶段补充。
                mode: values.collectConfig?.mode,
                onceTime: values.collectConfig?.onceTime,
                periodType: values.collectConfig?.periodType,
                periodWeekdays: values.collectConfig?.periodWeekdays,
                periodMonthDays: values.collectConfig?.periodMonthDays,
                periodMonth: values.collectConfig?.periodMonth,
                periodDay: values.collectConfig?.periodDay,
                periodTime: values.collectConfig?.periodTime,
                periodYearDateTime: values.collectConfig?.periodYearDateTime,
                intervalHours: values.collectConfig?.intervalHours,
                intervalWeekdays: values.collectConfig?.intervalWeekdays,
                effectiveDateRange: values.collectConfig?.effectiveDateRange,
              }
              : values.collectConfig),
            cronExpr: buildOperationCollectionCron(values.collectConfig),
          }
          : undefined;
      await onSubmit({
        ...values,
        collectConfig,
        contentConfig: values.taskType === 'content' && !isSimpleRequirement ? values.contentConfig : undefined,
        analyzeConfig: values.taskType === 'analyze' && !isSimpleRequirement ? values.analyzeConfig : undefined,
      });
    } catch (error) {
      if (!isFormValidationError(error)) {
        message.error(t('saveFailed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [form, isSimpleRequirement, loading, onSubmit, t]);

  const handleCancel = useCallback(() => {
    if (!isSubmitting) onCancel();
  }, [isSubmitting, onCancel]);

  const organizeTemplates = useMemo(() => options.organizeTemplates || [], [options.organizeTemplates]);
  useEffect(() => {
    if (!open || !collectOrganize || !organizeTemplates.length) return;
    const currentTemplateId = form.getFieldValue(['collectConfig', 'organizeTemplateId']);
    if (hasIdentifier(currentTemplateId)) return;
    const firstTemplate = organizeTemplates[0];
    // 本体列表异步加载完成后默认选中第一项，避免打开知识整理后还要再次弹窗选择。
    form.setFieldsValue({
      collectConfig: {
        ...(form.getFieldValue('collectConfig') || {}),
        organizeTemplateId: firstTemplate.value,
        knowledgeOrganization: {
          mode: 'existing',
          templateId: firstTemplate.value,
          templateName: firstTemplate.label,
        },
      },
    });
  }, [collectOrganize, form, open, organizeTemplates]);

  const handleKnowledgeTemplateChange = useCallback(
    (templateId: OperationIdentifier) => {
      const selectedTemplate = organizeTemplates.find((template) => `${template.value}` === `${templateId}`);
      form.setFieldValue(['collectConfig', 'knowledgeOrganization'], {
        mode: 'existing',
        templateId,
        templateName: selectedTemplate?.label,
      });
    },
    [form, organizeTemplates]
  );

  const renderCollectFields = () => (
    <section className={styles.operationTaskSection}>
      <h3>{isSimpleRequirement ? entityT('executionTitle') : t('collect.title')}</h3>
      <div className={styles.operationFormGrid}>
        {!isSimpleRequirement && (
          <>
            <Form.Item
              label={t('field.collectChannel')}
              name={['collectConfig', 'channel']}
              rules={[{ required: true, message: t('validation.collectChannelRequired') }]}
            >
              <Select options={collectChannels} loading={optionLoading} placeholder={t('placeholder.collectChannel')} />
            </Form.Item>
            <Form.Item
              label={t('field.collectAccountOrAddress')}
              name={['collectConfig', 'accountOrAddress']}
              rules={[
                {
                  required: true,
                  whitespace: !isPlatformCollectChannel,
                  message: t(
                    isPlatformCollectChannel
                      ? 'validation.collectAccountRequired'
                      : 'validation.collectAccountOrAddressRequired'
                  ),
                },
              ]}
            >
              {isPlatformCollectChannel ? (
                <Select
                  options={collectAccountOptions}
                  loading={optionLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('placeholder.collectAccount')}
                  notFoundContent={t('emptyAccount')}
                />
              ) : (
                <Input placeholder={t('placeholder.collectAccountOrAddress')} />
              )}
            </Form.Item>
            <Form.Item
              className={styles.operationFormFull}
              label={t('field.collectTopic')}
              name={['collectConfig', 'topic']}
              rules={[{ required: true, whitespace: true, message: t('validation.collectTopicRequired') }]}
            >
              {/* 采集主题可能包含多个关键词或说明，独占整行并提供两行输入空间。 */}
              <Input.TextArea rows={2} maxLength={1000} showCount placeholder={t('placeholder.collectTopic')} />
            </Form.Item>
            <Form.Item
              label={t('field.knowledgeBase')}
              name={['collectConfig', 'knowledgeBaseId']}
              rules={[{ required: true, message: t('validation.knowledgeBaseRequired') }]}
            >
              <Select
                options={options.knowledgeBases || []}
                loading={optionLoading}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('placeholder.knowledgeBase')}
                notFoundContent={t('emptyOption')}
              />
            </Form.Item>
            <Form.Item label={t('field.directory')} name={['collectConfig', 'directoryId']}>
              <Select
                options={directoryOptions}
                loading={optionLoading}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('placeholder.directory')}
                notFoundContent={t('emptyOption')}
              />
            </Form.Item>
          </>
        )}
        <div className={styles.operationScheduleTopRow}>
          <Form.Item
            className={styles.operationScheduleModeField}
            label={t('field.collectMode')}
            name={['collectConfig', 'mode']}
            rules={[{ required: true, message: t('validation.collectModeRequired') }]}
          >
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'once', label: t('collect.mode.once') },
                { value: 'periodic', label: t('collect.mode.periodic') },
                { value: 'interval', label: t('collect.mode.interval') },
              ]}
            />
          </Form.Item>
          {collectMode === 'periodic' && (
            <div className={styles.operationScheduleInlineFields}>
              <Form.Item
                className={styles.operationScheduleQuarterField}
                label={t('field.collectPeriodType')}
                name={['collectConfig', 'periodType']}
                rules={[{ required: true, message: t('validation.collectPeriodTypeRequired') }]}
              >
                <Select
                  options={[
                    { value: 'daily', label: t('collect.period.daily') },
                    { value: 'weekly', label: t('collect.period.weekly') },
                    { value: 'biweekly', label: t('collect.period.biweekly') },
                    { value: 'monthly', label: t('collect.period.monthly') },
                    { value: 'yearly', label: t('collect.period.yearly') },
                  ]}
                />
              </Form.Item>
              {collectPeriodType === 'yearly' ? (
                <Form.Item
                  className={styles.operationScheduleQuarterField}
                  label={t('field.collectYearDateTime')}
                  name={['collectConfig', 'periodYearDateTime']}
                  rules={[{ required: true, message: t('validation.collectYearDateTimeRequired') }]}
                >
                  {/* 年度周期只关心月、日和时分，固定使用闰年承载值以支持选择 2 月 29 日。 */}
                  <DatePicker
                    showTime={{ format: 'HH:mm' }}
                    format="MM-DD HH:mm"
                    defaultPickerValue={COLLECTION_DATE_CARRIER_START}
                    minDate={COLLECTION_DATE_CARRIER_START}
                    maxDate={COLLECTION_DATE_CARRIER_END}
                  />
                </Form.Item>
              ) : (
                <Form.Item
                  className={styles.operationScheduleQuarterField}
                  label={t('field.collectPeriodTime')}
                  name={['collectConfig', 'periodTime']}
                  rules={[{ required: true, message: t('validation.collectPeriodTimeRequired') }]}
                >
                  <TimePicker format="HH:mm" />
                </Form.Item>
              )}
            </div>
          )}
          {collectMode === 'once' && (
            <div className={styles.operationScheduleHalfFieldArea}>
              <Form.Item
                className={styles.operationScheduleOnceTimeField}
                label={t('field.collectOnceTime')}
                name={['collectConfig', 'onceTime']}
                rules={[{ required: true, message: t('validation.collectOnceTimeRequired') }]}
              >
                <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" />
              </Form.Item>
            </div>
          )}
          {collectMode === 'interval' && (
            <div className={styles.operationScheduleHalfFieldArea}>
              <Form.Item
                className={styles.operationScheduleIntervalField}
                label={t('field.collectIntervalHours')}
                name={['collectConfig', 'intervalHours']}
                rules={[{ required: true, message: t('validation.collectIntervalRequired') }]}
              >
                <InputNumber className={styles.operationIntervalHoursInput} min={1} precision={0} />
              </Form.Item>
            </div>
          )}
        </div>
        {collectMode === 'interval' && (
          <>
            <Form.Item
              className={styles.operationFormFull}
              label={t('field.collectWeekdays')}
              name={['collectConfig', 'intervalWeekdays']}
              rules={[{ required: true, type: 'array', min: 1, message: t('validation.collectWeekdaysRequired') }]}
            >
              <Select
                mode="multiple"
                maxTagCount="responsive"
                options={weekdayOptions}
                placeholder={t('placeholder.collectWeekdays')}
              />
            </Form.Item>
            <Form.Item
              label={
                <span className={styles.operationEffectiveDateLabel}>
                  <span>{t('field.collectEffectiveDateRange')}</span>
                  <span className={styles.operationEffectiveDateHint}>{t('collect.effectiveRangeHint')}</span>
                </span>
              }
              name={['collectConfig', 'effectiveDateRange']}
            >
              <DatePicker.RangePicker className={styles.operationFullControl} />
            </Form.Item>
          </>
        )}
        {collectMode === 'periodic' && (
          <>
            {(collectPeriodType === 'weekly' || collectPeriodType === 'biweekly') && (
              <Form.Item
                className={styles.operationFormFull}
                label={t('field.collectWeekdays')}
                name={['collectConfig', 'periodWeekdays']}
                rules={[{ required: true, type: 'array', min: 1, message: t('validation.collectWeekdaysRequired') }]}
              >
                <Select
                  mode="multiple"
                  maxTagCount="responsive"
                  options={weekdayOptions}
                  placeholder={t('placeholder.collectWeekdays')}
                />
              </Form.Item>
            )}
            {collectPeriodType === 'monthly' && (
              <Form.Item
                className={styles.operationFormFull}
                label={t('field.collectMonthDays')}
                name={['collectConfig', 'periodMonthDays']}
                rules={[{ required: true, type: 'array', min: 1, message: t('validation.collectMonthDaysRequired') }]}
              >
                <Select
                  mode="multiple"
                  maxTagCount="responsive"
                  options={monthDayOptions}
                  placeholder={t('placeholder.collectMonthDays')}
                />
              </Form.Item>
            )}
            <Form.Item
              label={
                <span className={styles.operationEffectiveDateLabel}>
                  <span>{t('field.collectEffectiveDateRange')}</span>
                  <span className={styles.operationEffectiveDateHint}>{t('collect.effectiveRangeHint')}</span>
                </span>
              }
              name={['collectConfig', 'effectiveDateRange']}
            >
              <DatePicker.RangePicker className={styles.operationFullControl} />
            </Form.Item>
          </>
        )}
        {!isSimpleRequirement && (
          <div className={styles.operationKnowledgeOrganizationRow}>
            <Form.Item label={t('field.organize')} name={['collectConfig', 'organize']} valuePropName="checked">
              <Switch
                checkedChildren={t('common.yes')}
                unCheckedChildren={t('common.no')}
                onChange={(checked) => {
                  if (checked) {
                    const currentCollectConfig = form.getFieldValue('collectConfig') || {};
                    const selectedTemplateId = currentCollectConfig.organizeTemplateId ?? organizeTemplates[0]?.value;
                    const selectedTemplate = organizeTemplates.find(
                      (template) => `${template.value}` === `${selectedTemplateId}`
                    );
                    // 开启知识整理后直接使用当前页面的本地本体列表，不再额外打开配置弹窗。
                    form.setFieldsValue({
                      collectConfig: {
                        ...currentCollectConfig,
                        organize: true,
                        organizeTemplateId: selectedTemplateId,
                        knowledgeOrganization: selectedTemplateId
                          ? {
                            mode: 'existing',
                            templateId: selectedTemplateId,
                            templateName: selectedTemplate?.label,
                          }
                          : undefined,
                      },
                    });
                    return;
                  }
                  form.setFieldsValue({
                    collectConfig: {
                      ...(form.getFieldValue('collectConfig') || {}),
                      organize: false,
                      organizeTemplateId: undefined,
                      knowledgeOrganization: undefined,
                    },
                  });
                }}
              />
            </Form.Item>
            {collectOrganize && (
              <Form.Item
                label={t('field.organizeTemplate')}
                name={['collectConfig', 'organizeTemplateId']}
                rules={[{ required: true, message: t('validation.organizeTemplateRequired') }]}
              >
                <Select
                  options={organizeTemplates}
                  loading={optionLoading}
                  disabled={isSubmitting}
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('placeholder.organizeTemplate')}
                  notFoundContent={null}
                  onChange={handleKnowledgeTemplateChange}
                />
              </Form.Item>
            )}
            {/*
              暂停“新增本体”能力，知识整理当前只允许直接选择本地已有本体。
              后续恢复时应重新设计本体创建和列表刷新流程，避免在需求表单中嵌套弹窗。
            */}
          </div>
        )}
      </div>
    </section>
  );

  const renderContentFields = () => (
    <section className={styles.operationTaskSection}>
      <h3>{t('content.title')}</h3>
      <div className={styles.operationFormGrid}>
        <Form.Item
          label={t('field.contentType')}
          name={['contentConfig', 'contentType']}
          rules={[{ required: true, message: t('validation.contentTypeRequired') }]}
        >
          <Select options={contentTypes} loading={optionLoading} placeholder={t('placeholder.contentType')} />
        </Form.Item>
        <Form.Item
          label={t('field.publishChannel')}
          name={['contentConfig', 'publishChannel']}
          rules={[{ required: true, message: t('validation.publishChannelRequired') }]}
        >
          <Select options={publishChannels} loading={optionLoading} placeholder={t('placeholder.publishChannel')} />
        </Form.Item>
        <Form.Item
          className={styles.operationFormFull}
          label={t('field.publishAccount')}
          name={['contentConfig', 'publishAccountId']}
          rules={[{ required: true, message: t('validation.publishAccountRequired') }]}
        >
          <Select
            options={publishAccountOptions}
            loading={optionLoading}
            showSearch
            optionFilterProp="label"
            placeholder={t('placeholder.publishAccount')}
            notFoundContent={t('emptyAccount')}
          />
        </Form.Item>
        <Form.Item
          className={styles.operationFormFull}
          label={t('field.contentTopic')}
          name={['contentConfig', 'topic']}
          rules={[{ required: true, whitespace: true, message: t('validation.contentTopicRequired') }]}
        >
          <Input placeholder={t('placeholder.contentTopic')} />
        </Form.Item>
        <Form.Item
          className={styles.operationFormFull}
          label={t('field.publishSchedule')}
          name={['contentConfig', 'publishSchedule']}
          rules={[{ required: true, whitespace: true, message: t('validation.publishScheduleRequired') }]}
        >
          <Input placeholder={t('placeholder.publishSchedule')} />
        </Form.Item>
      </div>
    </section>
  );

  const renderAnalyzeFields = () => (
    <section className={styles.operationTaskSection}>
      <h3>{t('analyze.title')}</h3>
      <div className={styles.operationFormGrid}>
        <Form.Item
          label={t('field.analysisPlatform')}
          name={['analyzeConfig', 'platformId']}
          rules={[{ required: true, message: t('validation.analysisPlatformRequired') }]}
        >
          <Select options={analysisPlatforms} loading={optionLoading} placeholder={t('placeholder.analysisPlatform')} />
        </Form.Item>
        <Form.Item
          label={t('field.analysisAccount')}
          name={['analyzeConfig', 'accountId']}
          rules={[{ required: true, message: t('validation.analysisAccountRequired') }]}
        >
          <Select
            options={analysisAccountOptions}
            loading={optionLoading}
            showSearch
            optionFilterProp="label"
            placeholder={t('placeholder.analysisAccount')}
            notFoundContent={t('emptyAccount')}
          />
        </Form.Item>
        <Form.Item
          className={styles.operationFormFull}
          label={t('field.analysisScope')}
          name={['analyzeConfig', 'scope']}
          rules={[{ required: true, message: t('validation.analysisScopeRequired') }]}
        >
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'account', label: t('analyze.scope.account') },
              { value: 'works', label: t('analyze.scope.works') },
            ]}
          />
        </Form.Item>
        {analysisScope === 'works' && (
          <Form.Item
            className={styles.operationFormFull}
            label={t('field.analysisWorks')}
            name={['analyzeConfig', 'workIds']}
            rules={[{ required: true, message: t('validation.analysisWorksRequired') }]}
            extra={t('analyze.worksHint')}
          >
            <Select
              mode="multiple"
              options={analysisWorkOptions}
              loading={optionLoading}
              showSearch
              allowClear
              maxTagCount="responsive"
              optionFilterProp="label"
              placeholder={t('placeholder.analysisWorks')}
              notFoundContent={t('emptyWork')}
            />
          </Form.Item>
        )}
      </div>
    </section>
  );

  return (
    <Modal
      title={modalTitle}
      open={open}
      centered
      width={isSimpleRequirement ? 650 : 800}
      className={styles.operationTaskModal}
      confirmLoading={isSubmitting}
      closable={!isSubmitting}
      maskClosable={!isSubmitting}
      keyboard={!isSubmitting}
      destroyOnClose
      okText={submitText}
      cancelText={t('cancel')}
      cancelButtonProps={{ disabled: isSubmitting }}
      onCancel={handleCancel}
      onOk={() => void handleSubmit()}
    >
      <Form<OperationTaskFormValues> form={form} layout="vertical">
        <div className={styles.operationTaskFormBody}>
          <div className={styles.operationFormGrid}>
            <Form.Item
              className={styles.operationFormFull}
              label={entityT('field.name')}
              name="taskName"
              rules={[{ required: true, whitespace: true, message: entityT('validation.nameRequired') }]}
            >
              <Input maxLength={500} showCount placeholder={entityT('placeholder.name')} />
            </Form.Item>
            <Form.Item className={styles.operationFormFull} label={entityT('field.description')} name="description">
              {/* 需求描述与后端统一限制 1000 字，字数统计便于用户控制输入长度。 */}
              <Input.TextArea rows={2} maxLength={1000} showCount placeholder={entityT('placeholder.description')} />
            </Form.Item>
            <Form.Item
              className={styles.operationFormFull}
              label={entityT('field.type')}
              name="taskType"
              rules={[{ required: true, message: entityT('validation.typeRequired') }]}
            >
              {/* 与采集方式保持一致，类型切换更直观，同时保留三个类型的已填写配置。 */}
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                options={[
                  {
                    value: 'collect',
                    label: isSimpleRequirement ? entityT('type.collect') : t('taskType.collect'),
                  },
                  {
                    value: 'knowledge',
                    label: isSimpleRequirement ? entityT('type.knowledge') : t('taskType.knowledge'),
                  },
                  {
                    value: 'content',
                    label: isSimpleRequirement ? entityT('type.content') : t('taskType.content'),
                  },
                  {
                    value: 'analyze',
                    label: isSimpleRequirement ? entityT('type.analyze') : t('taskType.analyze'),
                  },
                ]}
              />
            </Form.Item>
          </div>

          {/* 普通任务切换类型时保留各类型已填写内容；新增需求的执行方式改在选择任务模板后的执行配置中设置。 */}
          {!isSimpleRequirement && taskType === 'collect' && renderCollectFields()}
          {!isSimpleRequirement && taskType === 'content' && renderContentFields()}
          {!isSimpleRequirement && taskType === 'analyze' && renderAnalyzeFields()}

          <section className={styles.operationTaskSection}>
            <h3>{isSimpleRequirement ? entityT('assignmentTitle') : t('assignment.title')}</h3>
            <div className={styles.operationFormGrid}>
              <Form.Item
                label={isSimpleRequirement ? entityT('field.assignee') : t('field.assignee')}
                name="assigneeId"
                rules={[
                  {
                    required: true,
                    message: isSimpleRequirement
                      ? entityT('validation.assigneeRequired')
                      : t('validation.assigneeRequired'),
                  },
                ]}
              >
                <Select
                  options={options.assignees || []}
                  loading={optionLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={isSimpleRequirement ? entityT('placeholder.assignee') : t('placeholder.assignee')}
                  notFoundContent={t('emptyAssignee')}
                />
              </Form.Item>
              <Form.Item
                label={isSimpleRequirement ? entityT('field.dueTime') : t('field.dueTime')}
                name="dueTime"
                rules={[
                  {
                    required: true,
                    message: isSimpleRequirement
                      ? entityT('validation.dueTimeRequired')
                      : t('validation.dueTimeRequired'),
                  },
                ]}
              >
                <DatePicker className={styles.operationFullControl} />
              </Form.Item>
            </div>
          </section>
        </div>
      </Form>
    </Modal>
  );
};

export default OperationTaskFormModal;
