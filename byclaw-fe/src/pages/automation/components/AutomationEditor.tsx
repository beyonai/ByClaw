import { Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space, TimePicker, message } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import QueryInput from '@/components/QueryInput';
import { createScanSource, updateScanSource } from '@/service/devloop';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import {
  ALL_WEEKDAYS,
  buildAutomationCron,
  buildAutomationSchedule,
  getAutomationFormInitialValues,
  parseAutomationConfig,
} from '../schedule';
import type { AutomationFormValues, AutomationSource, AutomationTemplate } from '../types';
import styles from '../index.module.less';

interface AutomationEditorProps {
  source?: AutomationSource;
  template?: AutomationTemplate;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const AutomationEditor: React.FC<AutomationEditorProps> = ({ source, template, onCancel, onSaved }) => {
  const intl = useIntl();
  const [form] = Form.useForm<AutomationFormValues>();
  const [saving, setSaving] = useState(false);
  const [promptDraft, setPromptDraft] = useState<{ text: string; resourceList: any[] }>({
    text: '',
    resourceList: [],
  });
  const { projects, loading: projectsLoading } = useProjectList();
  const scheduleMode = Form.useWatch('scheduleMode', form);
  const intervalUnit = Form.useWatch('intervalUnit', form);
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
      initialValues.intervalValue = template.schedule.intervalValue || template.schedule.intervalHours || 1;
      initialValues.intervalUnit = template.schedule.intervalUnit || 'hour';
      initialValues.periodWeekdays = template.schedule.weekdays || [...ALL_WEEKDAYS];
      initialValues.periodMonth = template.schedule.month || 1;
      initialValues.periodMonthDay = template.schedule.monthDay || 1;
      initialValues.periodDateTime = (initialValues.periodDateTime || initialValues.periodTime)
        ?.month((template.schedule.month || 1) - 1)
        .date(template.schedule.monthDay || 1);
      initialValues.periodMonthDays = template.schedule.monthDays || [template.schedule.monthDay || 1];
      initialValues.intervalWeekdays = template.schedule.intervalWeekdays || [...ALL_WEEKDAYS];
      setPromptDraft({ text: template.prompt, resourceList: [] });
    } else {
      const config = parseAutomationConfig(source?.config);
      setPromptDraft({ text: config.chatContent, resourceList: config.resourceList });
    }
    form.setFieldsValue(initialValues);
  }, [form, source, template]);

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
          <ClockCircleOutlined />
          <Button type="text" className={styles.editorBreadcrumbLink} onClick={onCancel}>
            {intl.formatMessage({ id: 'automation.title' })}
          </Button>
          <span>/</span>
          <strong>
            {intl.formatMessage({ id: source?.sourceId ? 'automation.editTitle' : 'automation.addTitle' })}
          </strong>
        </div>
        <Space>
          <Button onClick={onCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            {intl.formatMessage({ id: 'common.save' })}
          </Button>
        </Space>
      </div>
      <div className={styles.editorScroll}>
        <Form form={form} layout="vertical" className={styles.editorForm}>
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
            label={
              <span>
                {intl.formatMessage({ id: 'automation.workspace' })}
                <small className={styles.optionalLabel}>{intl.formatMessage({ id: 'automation.optional' })}</small>
              </span>
            }
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
              placeholder={intl.formatMessage({ id: 'automation.promptTip' })}
              minRows={6}
              maxRows={12}
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
                  <Space.Compact className={styles.intervalField}>
                    <Form.Item
                      name="intervalValue"
                      noStyle
                      rules={
                        intervalUnit === 'minute'
                          ? [
                            {
                              type: 'number',
                              max: 59,
                              message: intl.formatMessage({ id: 'automation.intervalMinuteMax' }),
                            },
                          ]
                          : undefined
                      }
                    >
                      <InputNumber
                        className={styles.intervalValueField}
                        min={1}
                        max={intervalUnit === 'minute' ? 59 : undefined}
                        precision={0}
                        step={1}
                      />
                    </Form.Item>
                    <Form.Item name="intervalUnit" noStyle>
                      <Select
                        className={styles.intervalUnitField}
                        options={[
                          { value: 'hour', label: intl.formatMessage({ id: 'automation.intervalUnit.hour' }) },
                          { value: 'minute', label: intl.formatMessage({ id: 'automation.intervalUnit.minute' }) },
                        ]}
                      />
                    </Form.Item>
                  </Space.Compact>
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
