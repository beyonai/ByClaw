/* eslint-disable react/jsx-indent */
/* eslint-disable react/jsx-indent-props */
/* eslint-disable indent */
import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, DatePicker, TimePicker, Select, Radio, message, Tag, Popover, Switch } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, getIntl } from '@umijs/max';
import dayjs, { Dayjs } from 'dayjs';
import type { IAgentCache } from '@/typescript/agent';
import { createScheduleTask, updateScheduleTask } from '@/service/task';

const { TextArea } = Input;
const { Option } = Select;

export interface ScheduleTaskModalProps {
  open: boolean;
  onClose: () => void;
  agentInfo?: IAgentCache;
  onOk?: (values: any) => void;
  editTask?: {
    taskId: number;
    taskName: string;
    statusCd: '00A' | '00X';
    executionCycle: 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM';
    executionFrequencys: string[];
    executionTime: string;
    executionContent: string;
  };
}

interface FormValues {
  taskName: string;
  taskStatus?: '00A' | '00X'; // 任务状态：00A-开启，00X-关闭
  repeatType: 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM'; // 执行周期：DAY-每天，WEEK-每周，MONTH-每月，CUSTOM-固定时间
  // 固定时间执行时使用
  triggerDateTime?: Dayjs;
  // 每天/每周/每月执行时使用
  triggerTime?: Dayjs;
  // 每周执行时使用
  repeatWeekDays?: number[];
  // 每月执行时使用（存储为日期号数组 1-31）
  repeatMonthDays?: number[];
  prompt: string;
}

const intlGlobal = getIntl();

// 多选日期选择器组件（选择日期号 1-31）
const MultipleDatePicker: React.FC<{
  value?: number[];
  onChange?: (days: number[]) => void;
}> = ({ value = [], onChange }) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>(value);
  const [currentMonth, setCurrentMonth] = useState(dayjs());

  useEffect(() => {
    setSelectedDays(value);
  }, [value]);

  const handleDayClick = (day: number) => {
    const isSelected = selectedDays.includes(day);
    let newDays: number[];
    if (isSelected) {
      newDays = selectedDays.filter((d) => d !== day);
    } else {
      newDays = [...selectedDays, day].sort((a, b) => a - b);
    }
    setSelectedDays(newDays);
    onChange?.(newDays);
  };

  const handleRemoveDay = (day: number) => {
    const newDays = selectedDays.filter((d) => d !== day);
    setSelectedDays(newDays);
    onChange?.(newDays);
  };

  // 获取当前月份的天数
  const daysInMonth = currentMonth.daysInMonth();
  // 获取当前月份第一天是星期几
  const firstDayOfMonth = currentMonth.startOf('month').day();

  // 生成日期数组
  const days: (number | null)[] = [];
  // 填充前面的空位
  for (let i = 0; i < firstDayOfMonth; i += 1) {
    days.push(null);
  }
  // 填充日期
  for (let i = 1; i <= daysInMonth; i += 1) {
    days.push(i);
  }

  const panelContent = (
    <div style={{ width: '300px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <span
          style={{ cursor: 'pointer', userSelect: 'none', padding: '0 4px' }}
          onClick={() => setCurrentMonth(currentMonth.subtract(1, 'year'))}
        >
          &lt;&lt;
        </span>
        <span
          style={{ cursor: 'pointer', userSelect: 'none', padding: '0 4px' }}
          onClick={() => setCurrentMonth(currentMonth.subtract(1, 'month'))}
        >
          &lt;
        </span>
        <span style={{ fontWeight: 500, padding: '0 8px' }}>
          {currentMonth.format(intl.formatMessage({ id: 'employees.scheduleTaskModal.monthFormat' }))}
        </span>
        <span
          style={{ cursor: 'pointer', userSelect: 'none', padding: '0 4px' }}
          onClick={() => setCurrentMonth(currentMonth.add(1, 'month'))}
        >
          &gt;
        </span>
        <span
          style={{ cursor: 'pointer', userSelect: 'none', padding: '0 4px' }}
          onClick={() => setCurrentMonth(currentMonth.add(1, 'year'))}
        >
          &gt;&gt;
        </span>
      </div>
      <div style={{ padding: '12px' }}>
        {/* 星期标题 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
            marginBottom: '8px',
          }}
        >
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <div
              key={day}
              style={{
                textAlign: 'center',
                fontSize: '12px',
                color: '#8c8c8c',
                padding: '4px 0',
              }}
            >
              {day}
            </div>
          ))}
        </div>
        {/* 日期网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
          }}
        >
          {days.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} />;
            }
            const isSelected = selectedDays.includes(day);
            return (
              <div
                key={day}
                onClick={() => handleDayClick(day)}
                style={{
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: isSelected ? '#1677ff' : 'transparent',
                  color: isSelected ? '#fff' : '#333',
                  fontSize: '14px',
                  transition: 'all 0.2s',
                  border: isSelected ? 'none' : '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#e6f7ff';
                    e.currentTarget.style.border = '1px solid #91d5ff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.border = '1px solid transparent';
                  }
                }}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <Popover content={panelContent} trigger="click" open={open} onOpenChange={setOpen} placement="bottomLeft">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          minHeight: '32px',
          padding: '4px 11px',
          border: '1px solid #d9d9d9',
          borderRadius: '6px',
          cursor: 'pointer',
          alignItems: 'center',
          background: '#fff',
        }}
        onClick={() => setOpen(!open)}
      >
        {selectedDays.length > 0 ? (
          selectedDays.map((day) => (
            <Tag
              key={day}
              closable
              onClose={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRemoveDay(day);
              }}
              style={{ margin: 0 }}
            >
              {day}
              {intl.formatMessage({ id: 'employees.scheduleTaskModal.daySuffix' })}
            </Tag>
          ))
        ) : (
          <span style={{ color: '#bfbfbf' }}>
            {intl.formatMessage({ id: 'employees.scheduleTaskModal.selectDatePlaceholder' })}
          </span>
        )}
        <CalendarOutlined style={{ marginLeft: 'auto', color: '#bfbfbf' }} />
      </div>
    </Popover>
  );
};

// 周几选项
const WEEK_DAY_OPTIONS = [
  { label: intlGlobal.formatMessage({ id: 'common.weekMon' }), value: 1 },
  { label: intlGlobal.formatMessage({ id: 'common.weekTue' }), value: 2 },
  { label: intlGlobal.formatMessage({ id: 'common.weekWed' }), value: 3 },
  { label: intlGlobal.formatMessage({ id: 'common.weekThu' }), value: 4 },
  { label: intlGlobal.formatMessage({ id: 'common.weekFri' }), value: 5 },
  { label: intlGlobal.formatMessage({ id: 'common.weekSat' }), value: 6 },
  { label: intlGlobal.formatMessage({ id: 'common.weekSun' }), value: 0 },
];

// 星期几数字转英文大写（前三个字母）
const WEEK_DAY_MAP: Record<number, string> = {
  0: 'SUN',
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
};

const ScheduleTaskModal: React.FC<ScheduleTaskModalProps> = ({ open, onClose, agentInfo, onOk, editTask }) => {
  const intl = useIntl();

  const [form] = Form.useForm<FormValues>();
  const repeatType = Form.useWatch('repeatType', form);
  const [loading, setLoading] = useState(false);
  const isEditMode = !!editTask;

  useEffect(() => {
    if (open) {
      // 重置表单
      form.resetFields();
      // 重置 loading
      setLoading(false);

      if (editTask) {
        // 编辑模式：回填表单数据
        const { taskName, statusCd, executionCycle, executionFrequencys, executionTime, executionContent } = editTask;

        const formValues: any = {
          taskName,
          taskStatus: statusCd,
          repeatType: executionCycle,
          prompt: executionContent,
        };

        // 根据执行周期设置时间和日期
        if (executionCycle === 'CUSTOM') {
          // 固定时间：解析完整日期时间
          // executionTime 可能是 "YYYY-MM-DD HH:mm:ss" 格式
          formValues.triggerDateTime = dayjs(executionTime);
        } else {
          // 每天/每周/每月：设置时间
          // executionTime 是 "HH:mm:ss" 格式
          const timeStr = executionTime;
          // 如果已经是完整格式，只取时间部分
          let timeValue = timeStr;
          if (timeStr.includes(' ')) {
            timeValue = timeStr.split(' ')[1] || timeStr;
          }
          formValues.triggerTime = dayjs(`2000-01-01 ${timeValue}`, 'YYYY-MM-DD HH:mm:ss');

          // 每周：转换执行频率
          if (executionCycle === 'WEEK') {
            const weekDayReverseMap: Record<string, number> = {
              SUN: 0,
              MON: 1,
              TUE: 2,
              WED: 3,
              THU: 4,
              FRI: 5,
              SAT: 6,
              // 兼容旧数据格式（完整单词）
              SUNDAY: 0,
              MONDAY: 1,
              TUESDAY: 2,
              WEDNESDAY: 3,
              THURSDAY: 4,
              FRIDAY: 5,
              SATURDAY: 6,
            };
            formValues.repeatWeekDays = executionFrequencys
              .map((day) => weekDayReverseMap[day])
              .filter((day) => day !== undefined);
          } else if (executionCycle === 'MONTH') {
            // 每月：转换执行频率为数字数组
            formValues.repeatMonthDays = executionFrequencys
              .map((day) => parseInt(day, 10))
              .filter((day) => !isNaN(day));
          }
        }

        form.setFieldsValue(formValues);
      } else {
        // 新建模式：设置默认值
        const nextHour = dayjs().add(1, 'hour').minute(0).second(0);
        form.setFieldsValue({
          repeatType: 'CUSTOM', // 默认固定时间
          triggerDateTime: nextHour,
          triggerTime: nextHour,
          taskStatus: '00A', // 默认开启
        });
      }
    }
  }, [open, form, editTask]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();

      // 构建接口参数
      const apiParams: any = {
        taskName: values.taskName,
        resourceId: agentInfo?.agentId,
        statusCd: values.taskStatus || '00A',
        executionCycle: values.repeatType,
        executionContent: values.prompt,
      };

      // 根据执行周期处理时间和执行频率
      if (values.repeatType === 'CUSTOM') {
        // 固定时间执行：使用完整的日期时间
        if (!values.triggerDateTime) {
          message.error(intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' }));
          return;
        }
        // 检查时间是否已过期
        if (values.triggerDateTime.isBefore(dayjs())) {
          message.warning(intl.formatMessage({ id: 'employees.scheduleTaskModal.timeBeforeNow' }));
          return;
        }
        apiParams.executionTime = values.triggerDateTime.format('YYYY-MM-DD HH:mm:ss');
        apiParams.executionFrequencys = []; // 固定时间不需要执行频率
      } else {
        // 每天/每周/每月执行：使用时分秒
        if (!values.triggerTime) {
          message.error(intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' }));
          return;
        }
        apiParams.executionTime = values.triggerTime.format('HH:mm:ss');

        // 每周执行：需要选择执行日期，转换为英文大写
        if (values.repeatType === 'WEEK') {
          if (!values.repeatWeekDays || values.repeatWeekDays.length === 0) {
            message.error(intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteDate' }));
            return;
          }
          apiParams.executionFrequencys = values.repeatWeekDays.map((day: number) => WEEK_DAY_MAP[day]);
        } else if (values.repeatType === 'MONTH') {
          // 每月执行：需要选择执行日期，转换为字符串数组
          if (!values.repeatMonthDays || values.repeatMonthDays.length === 0) {
            message.error(intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteDate' }));
            return;
          }
          apiParams.executionFrequencys = values.repeatMonthDays.map((day: number) => `${day}`);
        } else {
          // 每天执行：不需要执行频率
          apiParams.executionFrequencys = [];
        }
      }

      // 调用接口
      setLoading(true);
      try {
        if (isEditMode && editTask) {
          // 编辑模式：调用更新接口
          await updateScheduleTask({
            ...apiParams,
            taskId: editTask.taskId,
          });
          message.success(intl.formatMessage({ id: 'employees.scheduleTaskModal.updateSuccess' }));
        } else {
          // 新建模式：调用创建接口
          await createScheduleTask(apiParams);
          message.success(intl.formatMessage({ id: 'employees.scheduleTaskModal.createSuccess' }));
        }
        // 调用回调函数
        onOk?.(apiParams);
        onClose();
      } catch (error: any) {
        console.error(isEditMode ? '更新定时任务失败:' : '创建定时任务失败:', error);
        message.error(
          error?.message ||
            intl.formatMessage({
              id: isEditMode ? 'employees.scheduleTaskModal.updateFailed' : 'employees.scheduleTaskModal.createFailed',
            })
        );
      } finally {
        setLoading(false);
      }
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={
        isEditMode
          ? intl.formatMessage({ id: 'employees.scheduleTaskModal.editTitle' })
          : intl.formatMessage({ id: 'employees.scheduleTaskModal.createTitle' })
      }
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      width={600}
      destroyOnHidden
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={loading}
    >
      <Form
        form={form}
        layout="horizontal"
        initialValues={{
          repeatType: 'CUSTOM',
        }}
      >
        <Form.Item
          label={intl.formatMessage({ id: 'employees.scheduleTaskModal.taskName' })}
          name="taskName"
          rules={[
            { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.taskNameRequired' }) },
            { max: 20, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.taskNameMax' }) },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({ id: 'employees.scheduleTaskModal.taskNamePlaceholder' })}
            maxLength={20}
            showCount
          />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'employees.scheduleTaskModal.taskStatus' })}
          name="taskStatus"
          rules={[
            { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.taskStatusRequired' }) },
          ]}
          getValueFromEvent={(checked: boolean) => (checked ? '00A' : '00X')}
          getValueProps={(value: '00A' | '00X') => ({ checked: value === '00A' })}
        >
          <Switch />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatType' })}
          name="repeatType"
          rules={[
            { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatTypeRequired' }) },
          ]}
        >
          <Radio.Group>
            <Radio value="CUSTOM">{intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatType.custom' })}</Radio>
            <Radio value="DAY">{intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatType.day' })}</Radio>
            <Radio value="WEEK">{intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatType.week' })}</Radio>
            <Radio value="MONTH">{intl.formatMessage({ id: 'employees.scheduleTaskModal.repeatType.month' })}</Radio>
          </Radio.Group>
        </Form.Item>

        {/* 每周执行：显示执行日期选择 */}
        {repeatType === 'WEEK' && (
          <Form.Item
            label={intl.formatMessage({ id: 'employees.scheduleTaskModal.executeDate' })}
            name="repeatWeekDays"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteDate' }) },
            ]}
          >
            <Select
              mode="multiple"
              placeholder={intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteDate' })}
              style={{ width: '100%' }}
              tagRender={(props) => {
                const { label, closable, onClose } = props;
                return (
                  <span
                    style={{
                      display: 'inline-block',
                      margin: '2px 4px',
                      padding: '0 8px',
                      background: '#f0f0f0',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    {label}
                    {closable && (
                      <span style={{ marginLeft: '4px', cursor: 'pointer' }} onClick={onClose}>
                        ×
                      </span>
                    )}
                  </span>
                );
              }}
            >
              {WEEK_DAY_OPTIONS.map((option) => (
                <Option key={option.value} value={option.value}>
                  {option.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

        {/* 每月执行：显示执行日期选择 */}
        {repeatType === 'MONTH' && (
          <Form.Item
            label={intl.formatMessage({ id: 'employees.scheduleTaskModal.executeDate' })}
            name="repeatMonthDays"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteDate' }) },
            ]}
          >
            <MultipleDatePicker />
          </Form.Item>
        )}

        {/* 固定时间执行：显示日期时间选择器 */}
        {repeatType === 'CUSTOM' && (
          <Form.Item
            label={intl.formatMessage({ id: 'employees.scheduleTaskModal.executeTime' })}
            name="triggerDateTime"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' }) },
            ]}
          >
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm:ss"
              style={{ width: '100%' }}
              placeholder={intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' })}
              disabledDate={(current) => {
                // 不能选择过去的日期
                return current && current < dayjs().startOf('day');
              }}
              disabledTime={(current) => {
                if (!current) return {};
                // 如果选择的是今天，禁用过去的时间
                if (current.isSame(dayjs(), 'day')) {
                  const now = dayjs();
                  return {
                    disabledHours: () => {
                      const hours = [];
                      for (let i = 0; i < now.hour(); i += 1) {
                        hours.push(i);
                      }
                      return hours;
                    },
                    disabledMinutes: (selectedHour: number) => {
                      if (selectedHour === now.hour()) {
                        const minutes = [];
                        for (let i = 0; i <= now.minute(); i += 1) {
                          minutes.push(i);
                        }
                        return minutes;
                      }
                      return [];
                    },
                    disabledSeconds: (selectedHour: number, selectedMinute: number) => {
                      if (selectedHour === now.hour() && selectedMinute === now.minute()) {
                        const seconds = [];
                        for (let i = 0; i <= now.second(); i += 1) {
                          seconds.push(i);
                        }
                        return seconds;
                      }
                      return [];
                    },
                  };
                }
                return {};
              }}
            />
          </Form.Item>
        )}

        {/* 每天/每周/每月执行：只显示时间选择器 */}
        {(repeatType === 'DAY' || repeatType === 'WEEK' || repeatType === 'MONTH') && (
          <Form.Item
            label={intl.formatMessage({ id: 'employees.scheduleTaskModal.executeTime' })}
            name="triggerTime"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' }) },
            ]}
          >
            <TimePicker
              format="HH:mm:ss"
              style={{ width: '100%' }}
              placeholder={intl.formatMessage({ id: 'employees.scheduleTaskModal.selectExecuteTime' })}
              showNow={false}
            />
          </Form.Item>
        )}

        <Form.Item
          label={intl.formatMessage({ id: 'employees.scheduleTaskModal.prompt' })}
          name="prompt"
          rules={[
            { required: true, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.promptRequired' }) },
            { max: 250, message: intl.formatMessage({ id: 'employees.scheduleTaskModal.promptMax' }) },
          ]}
        >
          <TextArea
            rows={4}
            placeholder={intl.formatMessage({ id: 'employees.scheduleTaskModal.promptPlaceholder' })}
            showCount
            maxLength={250}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ScheduleTaskModal;
