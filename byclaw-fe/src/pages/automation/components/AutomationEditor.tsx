import { Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space, TimePicker, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import QueryInput from '@/components/QueryInput';
import { createScanSource, updateScanSource } from '@/service/devloop';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import {
  ALL_WEEKDAYS,
  buildAutomationCron,
  buildAutomationSchedule,
  DEFAULT_WEEKDAYS,
  getAutomationFormInitialValues,
  normalizeIntervalValue,
  parseAutomationConfig,
} from '../schedule';
import type { AutomationFormValues, AutomationSource, AutomationTemplate } from '../types';
import styles from '../index.module.less';

interface AutomationEditorProps {
  source?: AutomationSource;
  template?: AutomationTemplate;
  projectId?: string | number;
  projectCloudResourceId?: string | number;
  breadcrumbLabel?: string;
  breadcrumbItemLabel?: string;
  onResourceReferenceChange?: (handler: (resource: any) => void) => void;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const AutomationEditor: React.FC<AutomationEditorProps> = ({
  source,
  template,
  projectId,
  projectCloudResourceId,
  breadcrumbLabel,
  breadcrumbItemLabel,
  onResourceReferenceChange,
  onCancel,
  onSaved,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<AutomationFormValues>();
  const [saving, setSaving] = useState(false);
  const [promptDraft, setPromptDraft] = useState<{ text: string; resourceList: any[] }>({
    text: '',
    resourceList: [],
  });
  const [promptDraftVersion, setPromptDraftVersion] = useState(0);
  const { projects, loading: projectsLoading } = useProjectList();
  // 新建入口可能未通过路由传入项目 ID（例如从聊天框进入），此时复用聊天框项目选择器
  // 写入的全局项目作用域，确保“项目空间”在页面初始化时自动回填。
  const [scopedProjectId] = useProjectScopeId();
  const resolvedProjectId = projectId ?? scopedProjectId;
  const selectedProjectId = Form.useWatch('projectId', form);
  const currentProjectId = selectedProjectId ?? resolvedProjectId;
  const currentProject = projects.find((item) => `${item.projectId}` === `${currentProjectId}`);
  useEffect(() => {
    onResourceReferenceChange?.((resource) => {
      const name = resource?.name || resource?.fileName || resource?.resourceName;
      if (!name) return;
      setPromptDraft((current) => ({
        text: `${current.text || ''}${current.text ? ' ' : ''}#${name}`,
        resourceList: [...(current.resourceList || []), resource],
      }));
      setPromptDraftVersion((version) => version + 1);
    });
    return () => onResourceReferenceChange?.(() => undefined);
  }, [onResourceReferenceChange]);
  const scheduleMode = Form.useWatch('scheduleMode', form);
  const intervalUnit = Form.useWatch('intervalUnit', form);
  const intervalValue = Form.useWatch('intervalValue', form);
  const intervalMin = intervalUnit === 'minute' ? 60 : 1;
  const intervalPrecision = intervalUnit === 'minute' ? 0 : 1;
  const intervalValidationMessage = intl.formatMessage({
    id: intervalUnit === 'minute' ? 'automation.intervalMinuteMin' : 'automation.intervalHourMin',
  });
  const intervalErrorMessage =
    intervalValue === undefined || intervalValue === null || intervalValue === ''
      ? undefined
      : !Number.isFinite(Number(intervalValue)) || Number(intervalValue) < intervalMin
        ? intervalValidationMessage
        : intervalUnit === 'minute' && !Number.isInteger(Number(intervalValue))
          ? intervalValidationMessage
          : undefined;
  const periodType = Form.useWatch('periodType', form);
  const weekdayOptions = useMemo(
    () =>
      ALL_WEEKDAYS.map((value) => ({
        value,
        label: intl.formatMessage({ id: `automation.weekday.${value}` }),
      })),
    [intl]
  );

  useEffect(() => {
    const initialValues = getAutomationFormInitialValues(source);
    if (template && !source) {
      initialValues.sourceName = template.name;
      initialValues.scheduleMode = template.schedule.mode;
      initialValues.periodType = template.schedule.periodType || 'daily';
      if (template.schedule.time) {
        const [hour, minute] = template.schedule.time.split(':').map(Number);
        initialValues.periodTime = initialValues.periodTime?.hour(hour).minute(minute);
      }
      initialValues.intervalUnit = template.schedule.intervalUnit || 'hour';
      initialValues.intervalValue = normalizeIntervalValue(
        template.schedule.intervalValue || template.schedule.intervalHours,
        initialValues.intervalUnit
      );
      initialValues.periodWeekdays = template.schedule.weekdays || [...DEFAULT_WEEKDAYS];
      initialValues.periodMonth = template.schedule.month || 1;
      initialValues.periodMonthDay = template.schedule.monthDay || 1;
      initialValues.periodDateTime = (initialValues.periodDateTime || initialValues.periodTime)
        ?.month((template.schedule.month || 1) - 1)
        .date(template.schedule.monthDay || 1);
      initialValues.periodMonthDays = template.schedule.monthDays || [template.schedule.monthDay || 1];
      initialValues.intervalWeekdays = template.schedule.intervalWeekdays || [...DEFAULT_WEEKDAYS];
      setPromptDraft({ text: template.prompt, resourceList: [] });
    } else {
      const config = parseAutomationConfig(source?.config);
      setPromptDraft({ text: config.chatContent, resourceList: config.resourceList });
    }
    if (!source && resolvedProjectId !== undefined && resolvedProjectId !== null) {
      initialValues.projectId = String(resolvedProjectId);
    }
    setPromptDraftVersion((version) => version + 1);
    form.setFieldsValue(initialValues);
  }, [form, resolvedProjectId, source, template]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const promptText = promptDraft.text.trim();
      if (!promptText) {
        message.error(intl.formatMessage({ id: 'automation.promptRequired' }));
        return;
      }
      const schedule = buildAutomationSchedule(values);
      const cronExpr = buildAutomationCron(schedule);
      if (!cronExpr) {
        message.error(intl.formatMessage({ id: 'automation.scheduleRequired' }));
        return;
      }
      setSaving(true);
      const config = JSON.stringify({
        chatContent: promptText,
        resourceList: promptDraft.resourceList || [],
        schedule,
      });
      if (source?.sourceId) {
        await updateScanSource({
          sourceId: Number(source.sourceId),
          sourceName: values.sourceName.trim(),
          cronExpr,
          config,
        });
      } else {
        await createScanSource({
          projectId: values.projectId ? Number(values.projectId) : undefined,
          sourceName: values.sourceName.trim(),
          sourceType: 'chat',
          cronExpr,
          config,
        });
      }
      message.success(intl.formatMessage({ id: 'automation.saveSuccess' }));
      await onSaved();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || intl.formatMessage({ id: 'automation.saveFailed' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editorPage}>
      <div className={styles.editorHeader}>
        <div className={styles.editorBreadcrumb}>
          <Button type="text" className={styles.editorBreadcrumbLink} onClick={onCancel}>
            {breadcrumbLabel || intl.formatMessage({ id: 'automation.title' })}
          </Button>
          <span className={styles.editorBreadcrumbSeparator}>/</span>
          {breadcrumbItemLabel && (
            <>
              <Button type="text" className={styles.editorBreadcrumbLink} onClick={onCancel}>
                {breadcrumbItemLabel}
              </Button>
              <span className={styles.editorBreadcrumbSeparator}>/</span>
            </>
          )}
          <span className={styles.editorBreadcrumbCurrent}>
            {intl.formatMessage({ id: source?.sourceId ? 'automation.editTitle' : 'automation.addTitle' })}
          </span>
        </div>
        <Space>
          <Button onClick={onCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            {intl.formatMessage({ id: 'common.save' })}
          </Button>
        </Space>
      </div>
      <div className={styles.editorScroll}>
        <Form
          form={form}
          layout="vertical"
          className={styles.editorForm}
          initialValues={
            resolvedProjectId !== undefined && resolvedProjectId !== null
              ? { projectId: String(resolvedProjectId) }
              : undefined
          }
        >
          <Form.Item
            name="sourceName"
            label={intl.formatMessage({ id: 'automation.name' })}
            rules={[
              {
                required: true,
                whitespace: true,
                message: intl.formatMessage({ id: 'automation.nameRequired' }),
              },
            ]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item
            name="projectId"
            label={intl.formatMessage({ id: 'automation.workspace' })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'automation.workspaceRequired',
                  defaultMessage: '请选择项目空间',
                }),
              },
            ]}
          >
            <Select
              allowClear
              showSearch
              disabled={Boolean(source?.sourceId)}
              loading={projectsLoading}
              optionFilterProp="label"
              placeholder={intl.formatMessage({ id: 'automation.workspacePlaceholder' })}
              options={projects.map((project) => ({
                value: `${project.projectId}`,
                label: project.projectName,
              }))}
            />
          </Form.Item>
          <Form.Item label={intl.formatMessage({ id: 'automation.prompt' })} required>
            <QueryInput
              key={promptDraftVersion}
              projectId={currentProjectId !== undefined ? Number(currentProjectId) : undefined}
              projectCloudResourceId={projectCloudResourceId ?? currentProject?.cloudResourceId}
              selectedProject={
                currentProjectId !== undefined
                  ? {
                    projectId: String(currentProjectId),
                    projectName: currentProject?.projectName || '',
                    cloudResourceId: projectCloudResourceId ?? currentProject?.cloudResourceId,
                  }
                  : undefined
              }
              placeholder={intl.formatMessage({ id: 'automation.promptTip' })}
              minRows={6}
              maxRows={12}
              enableTaskTemplate={false}
              mentionPopoverPlacement="bottomRight"
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
          <Form.Item
            label={
              <span>
                {intl.formatMessage({ id: 'automation.frequency' })}
                <small className={styles.fieldHint}>{intl.formatMessage({ id: 'automation.frequencyHint' })}</small>
              </span>
            }
          >
            <Form.Item name="scheduleMode" noStyle>
              <Radio.Group
                className={styles.scheduleMode}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'periodic', label: intl.formatMessage({ id: 'automation.schedule.periodic' }) },
                  { value: 'interval', label: intl.formatMessage({ id: 'automation.schedule.interval' }) },
                  { value: 'once', label: intl.formatMessage({ id: 'automation.schedule.once' }) },
                ]}
              />
            </Form.Item>
            <div className={styles.scheduleFields}>
              {scheduleMode === 'periodic' && (
                <>
                  <Form.Item name="periodType" noStyle>
                    <Select
                      className={styles.scheduleCompactField}
                      onChange={(nextPeriodType) => {
                        form.setFieldsValue({
                          periodType: nextPeriodType,
                          ...(nextPeriodType === 'weekly' || nextPeriodType === 'biweekly'
                            ? { periodWeekdays: [...DEFAULT_WEEKDAYS] }
                            : {}),
                        });
                      }}
                      options={[
                        { value: 'daily', label: intl.formatMessage({ id: 'automation.period.daily' }) },
                        { value: 'weekly', label: intl.formatMessage({ id: 'automation.period.weekly' }) },
                        { value: 'biweekly', label: intl.formatMessage({ id: 'automation.period.biweekly' }) },
                        { value: 'monthly', label: intl.formatMessage({ id: 'automation.period.monthly' }) },
                        { value: 'yearly', label: intl.formatMessage({ id: 'automation.period.yearly' }) },
                      ]}
                    />
                  </Form.Item>
                  {(periodType === 'weekly' || periodType === 'biweekly') && (
                    <Form.Item name="periodWeekdays" noStyle>
                      <Select mode="multiple" className={styles.scheduleWideField} options={weekdayOptions} />
                    </Form.Item>
                  )}
                  {periodType === 'yearly' && (
                    <Form.Item name="periodDateTime" noStyle>
                      <DatePicker
                        className={styles.scheduleYearlyDateTimeField}
                        format="MM月DD日 HH:mm"
                        showTime={{ format: 'HH:mm' }}
                        allowClear={false}
                      />
                    </Form.Item>
                  )}
                  {periodType === 'monthly' && (
                    <Form.Item
                      name="periodMonthDays"
                      noStyle
                      rules={[
                        {
                          required: true,
                          type: 'array',
                          min: 1,
                          message: intl.formatMessage({ id: 'automation.scheduleRequired' }),
                        },
                      ]}
                    >
                      <Select
                        mode="multiple"
                        className={styles.scheduleWideField}
                        maxTagCount="responsive"
                        options={Array.from({ length: 31 }, (_, index) => ({
                          value: index + 1,
                          label: intl.formatMessage({ id: 'automation.monthDay' }, { day: index + 1 }),
                        }))}
                      />
                    </Form.Item>
                  )}
                  {periodType !== 'yearly' && (
                    <Form.Item name="periodTime" noStyle>
                      <TimePicker className={styles.scheduleCompactField} format="HH:mm" />
                    </Form.Item>
                  )}
                </>
              )}
              {scheduleMode === 'interval' && (
                <>
                  <div className={styles.intervalField}>
                    <Form.Item
                      name="intervalValue"
                      className={styles.intervalValueItem}
                      help={null}
                      validateTrigger={['onChange', 'onBlur']}
                      rules={[
                        {
                          type: 'number',
                          min: intervalMin,
                          message: intervalValidationMessage,
                        },
                        {
                          validator: (_: unknown, value: number | null | undefined) => {
                            if (value === undefined || value === null) return Promise.resolve();
                            if (!Number.isFinite(value) || value < intervalMin) {
                              return Promise.reject(new Error(intervalValidationMessage));
                            }
                            if (intervalUnit === 'minute' && !Number.isInteger(value)) {
                              return Promise.reject(new Error(intervalValidationMessage));
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
                    >
                      <InputNumber
                        className={styles.intervalValueField}
                        min={intervalMin}
                        precision={intervalPrecision}
                        step={intervalUnit === 'minute' ? 1 : 0.1}
                      />
                    </Form.Item>
                    <Form.Item name="intervalUnit" noStyle>
                      <Select
                        className={styles.intervalUnitField}
                        onChange={(nextUnit) => {
                          form.setFieldsValue({
                            intervalUnit: nextUnit,
                            intervalValue: nextUnit === 'minute' ? 60 : 1,
                          });
                        }}
                        options={[
                          { value: 'hour', label: intl.formatMessage({ id: 'automation.intervalUnit.hour' }) },
                          { value: 'minute', label: intl.formatMessage({ id: 'automation.intervalUnit.minute' }) },
                        ]}
                      />
                    </Form.Item>
                    <span
                      className={intervalErrorMessage ? styles.intervalError : styles.fieldHint}
                      role={intervalErrorMessage ? 'alert' : undefined}
                    >
                      {intervalErrorMessage || intervalValidationMessage}
                    </span>
                  </div>
                  <Form.Item name="intervalWeekdays" noStyle>
                    <Select mode="multiple" className={styles.scheduleWideField} options={weekdayOptions} />
                  </Form.Item>
                </>
              )}
              {scheduleMode === 'once' && (
                <Form.Item name="onceTime" noStyle>
                  <DatePicker
                    className={styles.scheduleDateTimeField}
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                  />
                </Form.Item>
              )}
            </div>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default AutomationEditor;
