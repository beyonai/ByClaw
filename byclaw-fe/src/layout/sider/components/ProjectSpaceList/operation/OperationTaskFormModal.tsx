import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DatePicker, Form, Input, Modal, Radio, Select, Switch, message } from 'antd';
import { useIntl } from '@umijs/max';
import type {
  OperationAccount,
  OperationIdentifier,
  OperationPlatformOption,
  OperationSelectOption,
  OperationTaskFormOptions,
  OperationTaskFormValues,
} from './types';
import styles from './index.module.less';

// 三类运营需求复用此弹窗；父组件负责提供项目成员、账号和知识库等动态选项。
export interface OperationTaskFormModalProps {
  open: boolean;
  mode?: 'create' | 'edit';
  // 同一套三类配置表单可用于运营需求或历史运营任务，标题和提交文案按实体区分。
  entityLabel?: 'task' | 'requirement';
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

const OperationTaskFormModal: React.FC<OperationTaskFormModalProps> = ({
  open,
  mode = 'create',
  entityLabel = 'task',
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
  const collectMode = Form.useWatch(['collectConfig', 'mode'], form);
  const collectOrganize = Form.useWatch(['collectConfig', 'organize'], form);
  const collectKnowledgeBaseId = Form.useWatch(['collectConfig', 'knowledgeBaseId'], form);
  const publishChannel = Form.useWatch(['contentConfig', 'publishChannel'], form);
  const analysisPlatformId = Form.useWatch(['analyzeConfig', 'platformId'], form);
  const analysisAccountId = Form.useWatch(['analyzeConfig', 'accountId'], form);
  const analysisScope = Form.useWatch(['analyzeConfig', 'scope'], form);

  // 为三类任务分别预置最小可用配置，编辑场景再覆盖同名字段，避免切换类型时嵌套对象丢失。
  const formInitialValues = useMemo<OperationTaskFormValues>(
    () => ({
      taskName: '',
      description: '',
      taskType: 'collect',
      collectConfig: { mode: 'once', organize: false },
      contentConfig: {},
      analyzeConfig: { scope: 'account' },
      ...initialValues,
      collectConfig: {
        mode: 'once',
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
    () => getAccountOptions(options.accounts, publishChannel),
    [getAccountOptions, options.accounts, publishChannel]
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
    if (!open || !publishChannel || !options.accounts?.length) return;
    const selectedAccountId = form.getFieldValue(['contentConfig', 'publishAccountId']);
    const selectedAccount = options.accounts.find((account) => `${account.accountId}` === `${selectedAccountId}`);
    if (selectedAccount && selectedAccount.platformId !== publishChannel) {
      // 发布渠道一次只允许选择一个，切换渠道后清理原渠道账号，
      // 避免提交不一致的渠道和账号组合。
      form.setFieldValue(['contentConfig', 'publishAccountId'], undefined);
    }
  }, [form, open, options.accounts, publishChannel]);

  useEffect(() => {
    if (!open || !analysisPlatformId || !options.accounts?.length) return;
    const selectedAccountId = form.getFieldValue(['analyzeConfig', 'accountId']);
    const selectedAccount = options.accounts.find((account) => `${account.accountId}` === `${selectedAccountId}`);
    if (selectedAccount && selectedAccount.platformId !== analysisPlatformId) {
      // 分析平台变化时同步清理账号和作品，防止把旧平台作品带入新任务。
      form.setFieldsValue({
        analyzeConfig: {
          ...form.getFieldValue('analyzeConfig'),
          accountId: undefined,
          workIds: [],
        },
      });
    }
  }, [analysisPlatformId, form, open, options.accounts]);

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
      // 只提交当前任务类型的业务配置，避免表单切换后把其它类型的残留字段带给后端。
      await onSubmit({
        ...values,
        collectConfig: values.taskType === 'collect' ? values.collectConfig : undefined,
        contentConfig: values.taskType === 'content' ? values.contentConfig : undefined,
        analyzeConfig: values.taskType === 'analyze' ? values.analyzeConfig : undefined,
      });
    } catch (error) {
      if (!isFormValidationError(error)) {
        message.error(t('saveFailed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [form, loading, onSubmit, t]);

  const handleCancel = useCallback(() => {
    if (!isSubmitting) onCancel();
  }, [isSubmitting, onCancel]);

  const renderCollectFields = () => (
    <section className={styles.operationTaskSection}>
      <h3>{t('collect.title')}</h3>
      <div className={styles.operationFormGrid}>
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
          rules={[{ required: true, whitespace: true, message: t('validation.collectAccountOrAddressRequired') }]}
        >
          <Input placeholder={t('placeholder.collectAccountOrAddress')} />
        </Form.Item>
        <Form.Item
          label={t('field.collectTopic')}
          name={['collectConfig', 'topic']}
          rules={[{ required: true, whitespace: true, message: t('validation.collectTopicRequired') }]}
        >
          <Input placeholder={t('placeholder.collectTopic')} />
        </Form.Item>
        <Form.Item
          label={t('field.collectDateRange')}
          name={['collectConfig', 'dateRange']}
          rules={[{ required: true, message: t('validation.collectDateRangeRequired') }]}
        >
          <DatePicker.RangePicker className={styles.operationFullControl} />
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
        <Form.Item
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
            ]}
          />
        </Form.Item>
        {collectMode === 'periodic' && (
          <Form.Item
            label={t('field.collectSchedule')}
            name={['collectConfig', 'schedule']}
            rules={[{ required: true, whitespace: true, message: t('validation.collectScheduleRequired') }]}
          >
            <Input placeholder={t('placeholder.collectSchedule')} />
          </Form.Item>
        )}
        <Form.Item label={t('field.organize')} name={['collectConfig', 'organize']} valuePropName="checked">
          <Switch checkedChildren={t('common.yes')} unCheckedChildren={t('common.no')} />
        </Form.Item>
        {collectOrganize && (
          <Form.Item
            label={t('field.organizeTemplate')}
            name={['collectConfig', 'organizeTemplateId']}
            rules={[{ required: true, message: t('validation.organizeTemplateRequired') }]}
          >
            <Select
              options={options.organizeTemplates || []}
              loading={optionLoading}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('placeholder.organizeTemplate')}
              notFoundContent={t('emptyOption')}
            />
          </Form.Item>
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
      width={800}
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
              <Input.TextArea rows={3} placeholder={entityT('placeholder.description')} />
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
                  { value: 'collect', label: t('taskType.collect') },
                  { value: 'content', label: t('taskType.content') },
                  { value: 'analyze', label: t('taskType.analyze') },
                ]}
              />
            </Form.Item>
          </div>

          {/* 切换任务类型时保留各类型已填写内容，提交阶段只发送当前类型配置。 */}
          {taskType === 'collect' && renderCollectFields()}
          {taskType === 'content' && renderContentFields()}
          {taskType === 'analyze' && renderAnalyzeFields()}

          <section className={styles.operationTaskSection}>
            <h3>{t('assignment.title')}</h3>
            <div className={styles.operationFormGrid}>
              <Form.Item
                label={t('field.assignee')}
                name="assigneeId"
                rules={[{ required: true, message: t('validation.assigneeRequired') }]}
              >
                <Select
                  options={options.assignees || []}
                  loading={optionLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('placeholder.assignee')}
                  notFoundContent={t('emptyAssignee')}
                />
              </Form.Item>
              <Form.Item
                label={t('field.dueTime')}
                name="dueTime"
                rules={[{ required: true, message: t('validation.dueTimeRequired') }]}
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
